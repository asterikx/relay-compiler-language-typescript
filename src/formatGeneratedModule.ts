import { FormatModule } from "relay-compiler";
import * as ts from "typescript";
import addAnyTypeCast from "./addAnyTypeCast";

const createRequireRegex = () => /require\('(.*)'\)/g;

function getModuleName(path: string) {
  const [moduleName] = path.replace("./", "").split(".");
  return moduleName;
}

// collects all require calls and converts them static (top-level) or dynamic imports
const requireToImport = (
  content: string,
  enableDynamicImports: boolean = false
): string => {
  const requireRegex = createRequireRegex();

  // collect all require paths (unique)
  const requirePaths = new Set<string>();
  while (true) {
    const res = requireRegex.exec(content);
    if (res === null) {
      break;
    }
    requirePaths.add(res[1]);
  }
  // replace all require paths
  Array.from(requirePaths).forEach((requirePath) => {
    // dynamic or static (top-level) import
    const replacement = enableDynamicImports
      ? `await import('${requirePath.replace(".ts", "")}')`
      : getModuleName(requirePath);
    content = content.replace(`require('${requirePath}')`, replacement);
  });
  // add top-level imports
  if (!enableDynamicImports) {
    const topLevelImports = Array.from(requirePaths)
      .sort()
      .map(
        (requirePath) =>
          `import { ${getModuleName(requirePath)} } from "${requirePath.replace(
            ".ts",
            ""
          )}";`
      );
    return `${topLevelImports.join("\n")}
${content}`;
  }
  return content;
};

type FormatContentOptions = {
  // common options
} & (
  | {
      enableImportSyntax?: false;
    }
  | {
      enableImportSyntax: true;
      enableDynamicImportSyntax?: boolean;
    }
);

function formatContent(
  rawContent: string,
  options: FormatContentOptions
): string {
  if (!options.enableImportSyntax) {
    return rawContent;
  }
  return requireToImport(rawContent, options.enableDynamicImportSyntax);
}

export const formatterFactory = (
  compilerOptions: ts.CompilerOptions = {}
): FormatModule => ({
  moduleName,
  documentType,
  docText,
  concreteText,
  typeText,
  hash,
  sourceHash,
}) => {
  const { noImplicitAny, module = -1 } = compilerOptions;

  const documentTypeImport = documentType
    ? `import { ${documentType} } from "relay-runtime";`
    : "";
  const docTextComment = docText ? "\n/*\n" + docText.trim() + "\n*/\n" : "";
  let nodeStatement = `const node: ${
    documentType || "never"
  } = ${concreteText};`;
  if (noImplicitAny) {
    nodeStatement = addAnyTypeCast(nodeStatement).trim();
  }
  const rawContent = `${typeText || ""}

${docTextComment}
${nodeStatement}
(node as any).hash = '${sourceHash}';
export default node;
`;

  const content = `/* tslint:disable */
/* eslint-disable */
// @ts-nocheck
${hash ? `/* ${hash} */\n` : ""}
${documentTypeImport}
${formatContent(rawContent, {
  enableImportSyntax: module >= ts.ModuleKind.ES2015,
  enableDynamicImportSyntax: module >= ts.ModuleKind.ES2020,
})}`;
  return content;
};
