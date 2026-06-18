import { syntaxTree } from '@codemirror/language';

/* Extract the symbol path at the cursor — walk up the syntaxTree collecting function/class/tag nodes.
   Mapping only the language-specific node types covers PHP, JS/TS, Python, and HTML alike. No LSP or indexing needed (reuses the lezer tree).
   (Markdown headings and CSS selectors are deferred since their trees aren't hierarchical — for now, functions/classes/tags.) */

/* Named declaration nodes (function/class/method/interface, etc.) — pull the name node from the children. */
const NAMED = new Set([
  'FunctionDeclaration', 'FunctionDefinition', 'FunctionExpression',
  'MethodDeclaration', 'MethodDefinition',
  'ClassDeclaration', 'ClassDefinition', 'ClassExpression',
  'InterfaceDeclaration', 'TraitDeclaration', 'EnumDeclaration', 'EnumDefinition',
  'NamespaceDeclaration'
]);

/* Text of the name node among a declaration node's children. (Excludes parameter/argument names.) */
function declName(node, doc) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (/(Name|Identifier|Definition)$/.test(c.name) && !/(Param|Argument)/.test(c.name)) {
      return doc.sliceString(c.from, c.to);
    }
  }
  return null;
}

/* HTML Element → the opening tag's TagName. */
function htmlTag(node, doc) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'OpenTag' || c.name === 'SelfClosingTag') {
      for (let t = c.firstChild; t; t = t.nextSibling) {
        if (t.name === 'TagName') return doc.sliceString(t.from, t.to);
      }
    }
  }
  return null;
}

/* Array of symbol labels at the cursor (outermost→innermost). Empty array means no symbols. */
export function symbolPath(state) {
  const tree = syntaxTree(state);
  const doc = state.doc;
  const pos = state.selection.main.head;
  const out = [];
  for (let n = tree.resolveInner(pos, -1); n; n = n.parent) {
    let label = null;
    if (NAMED.has(n.name)) label = declName(n, doc);
    else if (n.name === 'Element') label = htmlTag(n, doc);
    if (label) out.unshift(label);
  }
  return out;
}
