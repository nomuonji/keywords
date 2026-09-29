import { z } from 'zod';
import { firestore, value } from '../../db/src/firestore.js';

function decode(doc: any) {
  return {
    id: String(doc.name ?? '').split('/').pop(),
    ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)]))
  } as any;
}

export const seoPlanningDigestGetShape = {
  siteId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
};
export const seoPlanningDigestListShape = {
  limit: z.number().int().min(1).max(100).default(50)
};

export async function seoPlanningDigestGet(input: unknown) {
  const { siteId } = z.object(seoPlanningDigestGetShape).strict().parse(input);
  try {
    const doc = await firestore(`/seoPlanningDigests/${siteId}`);
    return decode(doc);
  } catch (error: any) {
    if (Number(error?.status) === 404) return { siteId, digest: null };
    throw error;
  }
}

export async function seoPlanningDigestList(input: unknown) {
  const args = z.object(seoPlanningDigestListShape).strict().parse(input);
  const result = await firestore(`/seoPlanningDigests?pageSize=${args.limit}&orderBy=generatedAt%20desc`);
  const items = (result.documents ?? []).map((doc: any) => {
    const digest = decode(doc);
    return {
      siteId: digest.siteId,
      repository: digest.repository,
      productionUrl: digest.productionUrl,
      generatedAt: digest.generatedAt,
      measurementEnd: digest.measurementEnd,
      inventoryCount: digest.inventoryCount,
      selectedCount: digest.selectedCount,
      notObservedInComplete90dGscCount: digest.notObservedInComplete90dGscCount,
      statuses: digest.statuses
    };
  });
  return { items };
}
