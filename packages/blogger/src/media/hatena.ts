import { BlogMedia, HatenaConfig } from '../types';
import axios from 'axios';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export class HatenaMedia implements BlogMedia {
  private readonly config: HatenaConfig;

  constructor(config: HatenaConfig) {
    this.config = config;
  }

  async post(article: string): Promise<string> {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
    });
    const xmlContent = builder.build({
      entry: {
        '@_xmlns': 'http://www.w3.org/2005/Atom',
        '@_xmlns:app': 'http://www.w3.org/2007/app',
        title: 'New Post',
        author: { name: 'Jules' },
        content: {
          '@_type': 'text/plain',
          '#text': article,
        },
        category: {
          '@_term': 'API',
        },
        'app:control': {
          'app:draft': 'no',
        },
      },
    });

    const { data } = await axios.post(
      `https://blog.hatena.ne.jp/${this.config.hatenaId}/${this.config.blogId}/atom/entry`,
      xmlContent,
      {
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `Basic ${Buffer.from(
            `${this.config.hatenaId}:${this.config.apiKey}`
          ).toString('base64')}`,
        },
      }
    );

    const parser = new XMLParser();
    const parsed = parser.parse(data);
    return parsed.entry.id;
  }

  async getUrl(postId: string): Promise<string> {
    const { data } = await axios.get(
      `https://blog.hatena.ne.jp/${this.config.hatenaId}/${this.config.blogId}/atom/entry/${postId}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.config.hatenaId}:${this.config.apiKey}`
          ).toString('base64')}`,
        },
      }
    );

    const parser = new XMLParser();
    const parsed = parser.parse(data);
    return parsed.entry.link.find((l: any) => l['@_rel'] === 'alternate')['@_href'];
  }
}
