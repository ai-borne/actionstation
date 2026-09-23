/**
 * Knowledge Bank Types — Data model for workspace-level context
 * SSOT for all KB-related interfaces and constants
 */

/** Supported entry types in the Knowledge Bank */
export type KnowledgeBankEntryType = 'text' | 'image' | 'document';

/** Single entry in a workspace's Knowledge Bank */
export interface KnowledgeBankEntry {
    id: string;
    workspaceId: string;
    type: KnowledgeBankEntryType;
    title: string;
    content: string;             // Processed text (for images: AI description)
    summary?: string;            // AI-generated summary (for long entries)
    tags?: string[];             // User-defined tags for organization
    originalFileName?: string;
    storedFileName?: string;     // Actual Storage object name (may differ from originalFileName after compression) — used to build the delete path
    storageUrl?: string;         // Firebase Storage URL (images only)
    mimeType?: string;
    parentEntryId?: string | null; // Links chunks to parent document entry (null = standalone/parent)
    documentSummaryStatus?: 'pending' | 'ready'; // Tracks document-level summary availability
    pinned?: boolean;             // Pinned entries always rank first in AI context
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/** Shape of a new entry before persistence (no id/dates) */
export interface KnowledgeBankEntryInput {
    type: KnowledgeBankEntryType;
    title: string;
    content: string;
    tags?: string[];
    originalFileName?: string;
    storedFileName?: string;
    storageUrl?: string;
    mimeType?: string;
    parentEntryId?: string;
}

/** Filter option for searching KB entries */
export type KBTypeFilter = KnowledgeBankEntryType | 'all';

/** Per-entry summarization result */
export type SummaryEntryResult = 'success' | 'failed' | 'skipped';

/** Zustand store state */
export interface KnowledgeBankState {
    entries: KnowledgeBankEntry[];
    isPanelOpen: boolean;
    searchQuery: string;
    typeFilter: KBTypeFilter;
    selectedTag: string | null;
    /** IDs of entries currently being summarized */
    summarizingEntryIds: string[];
}

/** A parent document entry grouped with its child chunks */
export interface DocumentGroup {
    parent: KnowledgeBankEntry;
    children: KnowledgeBankEntry[];
    totalParts: number;
}

/** Result of grouping entries by document relationship */
export interface GroupedEntries {
    standalone: KnowledgeBankEntry[];
    documents: DocumentGroup[];
}

/** Zustand store actions */
export interface KnowledgeBankActions {
    setEntries: (entries: KnowledgeBankEntry[]) => void;
    addEntry: (entry: KnowledgeBankEntry) => void;
    updateEntry: (entryId: string, updates: Partial<KnowledgeBankEntry>) => void;
    removeEntry: (entryId: string) => void;
    toggleEntry: (entryId: string) => void;
    pinEntry: (entryId: string) => void;
    unpinEntry: (entryId: string) => void;
    getPinnedEntries: () => KnowledgeBankEntry[];
    clearEntries: () => void;
    setPanelOpen: (isOpen: boolean) => void;
    setSearchQuery: (query: string) => void;
    setTypeFilter: (filter: KBTypeFilter) => void;
    setSelectedTag: (tag: string | null) => void;
    setSummarizingEntryIds: (ids: string[]) => void;
    removeSummarizingEntryId: (id: string) => void;
    getEnabledEntries: () => KnowledgeBankEntry[];
    getFilteredEntries: () => KnowledgeBankEntry[];
    getAllTags: () => string[];
    getEntryCount: () => number;
    toggleDocumentGroup: (parentId: string) => void;
    removeDocumentGroup: (parentId: string) => void;
    getDocumentCount: () => number;
}

// ── Generation Type Budgets ─────────────────────────────

/** AI generation types that determine KB token budget */
export type KBGenerationType = 'single' | 'chain' | 'transform' | 'synthesis';

/** Token budgets per generation type — single gets most room, synthesis/transform least */
export const KB_TOKEN_BUDGETS: Record<KBGenerationType, number> = {
    single: 12_000,    // No parent chain → more room for KB
    chain: 4_000,      // Parent chain consumes context window
    transform: 3_000,  // Transforms need minimal KB reference
    synthesis: 3_000,  // Synthesis prompt itself is the primary context
} as const;

// ── Summary Depth Tiers ────────────────────────────────

/** Summarization depth tier based on content length */
export type SummaryTier = 'brief' | 'standard' | 'detailed';

/** Character thresholds that determine summary tier */
export const KB_SUMMARY_TIER_THRESHOLDS = {
    standard: 2_000,   // ≥ 2000 chars → standard
    detailed: 5_000,   // ≥ 5000 chars → detailed
} as const;

/** Max output tokens per summary tier */
export const KB_SUMMARY_TOKEN_LIMITS: Record<SummaryTier, number> = {
    brief: 128,
    standard: 256,
    detailed: 512,
} as const;

// ── Constants ──────────────────────────────────────────

/** @deprecated Use KB_MAX_DOCUMENTS for limit checks */
export const KB_MAX_ENTRIES = 50;
export const KB_MAX_DOCUMENTS = 25;
export const KB_MAX_CONTENT_SIZE = 10_000;        // 10KB text per entry
export const KB_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
export const KB_MAX_IMAGE_DIMENSION = 1024;        // px — longest side
export const KB_IMAGE_QUALITY = 0.7;               // JPEG compression
export const KB_MAX_CONTEXT_TOKENS = 8000;         // Token budget for AI
export const KB_CHARS_PER_TOKEN = 4;               // Approx chars per token (1 token ≈ 4 chars)
export const KB_CONTEXT_ENTRY_OVERHEAD = 30;       // ~chars per entry for "[Knowledge: ...]\n" wrapper
export const KB_CHUNK_THRESHOLD = 8_000;           // Chars before auto-chunking
export const KB_SUMMARY_THRESHOLD = 500;           // Chars before auto-summarization
export const KB_PDF_EXTRACTION_MAX_TOKENS = 8192;  // Max output tokens for Gemini PDF extraction
export const KB_MAX_TITLE_LENGTH = 100;             // Max chars per title
export const KB_PREVIEW_LENGTH = 120;              // Content preview truncation
export const KB_MAX_TAGS_PER_ENTRY = 5;            // Max tags per entry
export const KB_MAX_TAG_LENGTH = 30;               // Max chars per tag

export const KB_ACCEPTED_MIME_TYPES = [
    'text/plain', 'text/markdown', 'application/json',
    'image/png', 'image/jpeg',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
