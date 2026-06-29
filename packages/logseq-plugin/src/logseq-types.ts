// `@logseq/libs`'s package entry (index.d.ts) only declares the ambient `logseq`
// global — it doesn't re-export the model types those APIs operate on. Pull the
// handful we reference from the package's dist entry, centralized here so the one
// deep import path lives in a single place.
export type { PageEntity, BlockEntity, SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
