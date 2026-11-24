#!/usr/bin/env python3
"""M37 patch: prompts.ts — document-intel protocols + workflow protocol wiring."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/lib/riishe/prompts.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. import the workflow protocol (pure module, no cycle)
sub("""import { APPLICATION_IDENTITY, buildIdentityProtocol } from './identity'""",
"""import { APPLICATION_IDENTITY, buildIdentityProtocol } from './identity'
import { WORKFLOW_PROTOCOL } from './workflow'""")

# 2. PromptContext additions
sub("""  /** Detected prompt language display name ("Tamil", "English", …) — when
   *  non-English, adds the multilingual answer protocol. */
  userLanguage?: string
}""",
"""  /** Detected prompt language display name ("Tamil", "English", …) — when
   *  non-English, adds the multilingual answer protocol. */
  userLanguage?: string
  /** M37 §2: TWO OR MORE documents attached — adds the multi-document
   *  comparison protocol (document-by-document attribution, disagreements
   *  surfaced, extraction limits carried through). */
  multiDoc?: boolean
  /** M37 §2: STRICT document grounding requested ("based only on the
   *  documents") — adds the documents-only contract; the orchestrator has
   *  already suppressed web retrieval for the turn. */
  docGrounded?: boolean
  /** M37 §4: multi-step workflow turn (two or more capability domains) —
   *  adds the plan → execute → verify → deliver coordination protocol. */
  workflow?: { parts: ReadonlyArray<string> } | null
}""")

# 3. Extend DOCUMENT_PROTOCOL (page-reference honesty + structured summary)
sub("""- Verify important numerical claims against the extracted text before stating them, and flag any number you could not locate in the document.`""",
"""- Verify important numerical claims against the extracted text before stating them, and flag any number you could not locate in the document.
- Page references: cite a [page N] marker ONLY when the extraction actually carries it; never invent or guess a page number. When the extraction has no page markers (plain-text uploads), reference the document by name and quote/section instead — "the document" plus a short quote is always honest.
- When the user asks for a summary, structure it so every point is traceable to the extracted text: purpose/scope first, then key points each with their location (page marker when present, otherwise a short quote), then anything the extraction could not cover (per the processing note).`""")

# 4. New protocols after DOCUMENT_PROTOCOL
sub("""const IMAGE_PROTOCOL = `""",
"""const DOCUMENT_COMPARISON_PROTOCOL = `
Multi-document comparison protocol (two or more documents are attached):
- Address each document BY NAME — and by its [page N] marker when the extraction provides one — for every claim you draw from it; never blur which document said what.
- Where the documents AGREE, say so explicitly. Where they DISAGREE (numbers, dates, claims, recommendations), present each document's version side by side and state plainly that the disagreement is unresolved by the material provided.
- The comparison covers ONLY what the extractions actually contain. If a document is unreadable, truncated, or its processing note reports missing/skipped pages, say so and carry that limitation into the comparison instead of comparing against missing content.`

const STRICT_DOCUMENT_GROUND_PROTOCOL = `
Strict document-grounding contract (the user asked for an answer based ONLY on the attached documents):
- Answer ONLY from the attached document text provided in this conversation. Do NOT use general knowledge, outside facts or prior context to fill gaps — not even confident ones.
- When the documents do not contain the answer, say exactly that ("the documents do not contain <what is missing>") — that IS the answer for that part; never silently substitute outside knowledge.
- Attribute every statement to the document (and [page N] marker) it came from.
- If answering the question at all requires information beyond the documents, say so and ask whether the restriction may be relaxed — do not quietly broaden the sources.`

const IMAGE_PROTOCOL = `""")

# 5. buildSystemPrompt wiring
sub("""  if (ctx.task === 'document') prompt += DOCUMENT_PROTOCOL
  if (ctx.evidenceBlock) prompt += CITATION_PROTOCOL""",
"""  if (ctx.task === 'document') prompt += DOCUMENT_PROTOCOL
  if (ctx.multiDoc) prompt += DOCUMENT_COMPARISON_PROTOCOL
  if (ctx.docGrounded) prompt += STRICT_DOCUMENT_GROUND_PROTOCOL
  if (ctx.workflow) prompt += WORKFLOW_PROTOCOL
  if (ctx.evidenceBlock) prompt += CITATION_PROTOCOL""")

p.write_text(src)
print("prompts.ts patched OK")
