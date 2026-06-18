export const defaultEditorSettings = {
  fontSize: 14,
  lineHeight: 20,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  wordWrap: 'on',
  minimap: { enabled: true },
  lineNumbers: 'on',
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  foldingStrategy: 'auto',
  smoothScrolling: true,
  mouseWheelZoom: true,
  scrollBeyondLastLine: true,
  automaticLayout: true,
  roundedSelection: false,
  renderLineHighlight: 'line',
  renderWhitespace: 'selection',
  cursorBlinking: 'blink',
  cursorSmoothCaretAnimation: 'on',
  bracketPairColorization: { enabled: false },
  guides: {
    bracketPairs: false,
    bracketPairsHorizontal: false,
    highlightActiveIndentation: true,
    indentation: true
  },
  occurrencesHighlight: 'singleFile',
  selectionHighlight: true,
  quickSuggestions: {
    other: true,
    comments: false,
    strings: false
  },
  quickSuggestionsDelay: 10,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'on',
  acceptSuggestionOnCommitCharacter: true,
  snippetSuggestions: 'inline',
  wordBasedSuggestions: 'matchingDocuments',
  parameterHints: { enabled: true },
  formatOnType: true,
  formatOnPaste: true,
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  autoSurround: 'languageDefined',
  linkedEditing: true,
  matchBrackets: 'always',
  unicodeHighlight: {
    ambiguousCharacters: false
  }
};

export function buildMonacoOptions(overrides = {}) {
  return {
    ...defaultEditorSettings,
    ...overrides
  };
}
