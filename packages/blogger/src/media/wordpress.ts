import { BlogMedia, WordpressConfig } from '@keywords/core';
import axios from 'axios';

export class WordpressMedia implements BlogMedia {
  private readonly config: WordpressConfig;

  constructor(config: WordpressConfig) {
    this.config = config;
  }

  async post(article: string): Promise<string> {
    const { data } = await axios.post(
      `${this.config.url}/wp-json/wp/v2/posts`,
      {
        title: 'New Post',
        content: article,
        status: 'publish',
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.config.username}:${this.config.password}`
          ).toString('base64')}`,
        },
      }
    );
    return data.id;
  }

  async getUrl(postId: string): Promise<string> {
    const { data } = await axios.get(
      `${this.config.url}/wp-json/wp/v2/posts/${postId}`
    );
    return data.link;
  }
}
