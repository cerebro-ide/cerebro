export {
  CodeEditor,
  DEFAULT_KEYS,
  editorHistory,
  type CodeEditorProps,
  type EditorKeys,
} from './editor.js';
export {
  type AskCompletions,
  type CompletionEdit,
  type CompletionItem,
  type CompletionList,
  type ResolveCompletion,
} from './completions.js';
export { type AskDocumentation, type Documentation } from './documentation.js';
export {
  PARAMETERS_AFTER,
  type AskSignatures,
  type Signature,
  type Signatures,
} from './parameters.js';
export { NOTHING_TO_RENAME, type AskRenaming, type Rename, type Renaming } from './rename.js';
export { FOLDS_AFTER, type AskFolds, type Fold, type FoldKeys } from './folding.js';
export {
  ALREADY_FORMATTED,
  fileIn,
  formatIn,
  reindentIn,
  formattedLines,
  type AskFormat,
  type FormatEdit,
  type FormatWords,
} from './format.js';
export { blockComment, lineComment } from './comment.js';
export { moveLine } from './move-line.js';
export { duplicate, duplicateLines, editorDuplicate, inChangeableEditor } from './duplicate.js';
export { historyNamesIn } from './history.js';
export { languageFor, languageName } from './languages.js';
export {
  DiffEditor,
  diffSource,
  transferLine,
  type DiffControl,
  type DiffEditorProps,
  type DiffScroll,
} from './diff.js';
export { UnifiedDiffEditor } from './unified.js';
export {
  HIGHLIGHT_POLICIES,
  IGNORE_POLICIES,
  type HighlightPolicy,
  type IgnorePolicy,
  translateLine,
  type LineRange,
} from './compare.js';
export {
  MergeEditor,
  type MergeControl,
  type MergeEditorProps,
  type MergeLeft,
} from './merge-view.js';
export { mergeChanges, type Lines, type MergeChange, type MergeKind } from './merge.js';
export { EditorDocument, type FileFormat, type LineSeparator } from './document.js';
export { detectIndent, indentText, indentUnitOf, type Indent } from './indent.js';
export { formatLineColumn, parseLineColumn, positionText, type Selected } from './line.js';
export {
  problemIcon,
  PROBLEMS_AFTER,
  type AskProblems,
  type Problem,
  type Severity,
} from './problems.js';
export { MARKS_AFTER, type AskMarks, type Mark, type MarkerKind } from './markers.js';
export {
  ANNOTATIONS_AFTER,
  type AskAnnotation,
  type LineAnnotation,
  type TextAnnotation,
} from './annotations.js';
export {
  placeAt,
  USAGES_AFTER,
  type AskDefinition,
  type AskUsages,
  type Place,
  type Usage,
} from './usages.js';
export { applyCase } from './preserve-case.js';
export { findTextIn, preserveCaseIcon, SELECTION_LIMIT } from './find.js';
export { MarkdownPreview, type MarkdownPreviewProps } from './markdown-preview.js';
