import * as vscode from "vscode";
import * as hasbin from "hasbin";

import { Validator } from "./validator";
import { WgslDocumentSymbolProvider } from "./symbol_provider";

class WgslCompletionItemProvider<
  T extends vscode.CompletionItem = vscode.CompletionItem
> implements vscode.CompletionItemProvider {
  validator: Validator;
  items: { [key: string]: vscode.CompletionItem[] };

  constructor(v: Validator) {
    this.validator = v;
    this.items = {};
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    _position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<any[] | vscode.CompletionList<T>> {
    return new Promise((res, rej) => {
      if (document.languageId === "hlsl" || document.languageId === "wgsl") {
        this.validator.getFileTree(document, document.languageId, (json) => {
          const out: vscode.CompletionItem[] = [];

          if (json && json.result) {
            json.result.functions.map((f) => {
              const c = new vscode.CompletionItem(f);
              c.kind = vscode.CompletionItemKind.Function;
              out.push(c);
            });

            json.result.global_variables.map((v) => {
              const c = new vscode.CompletionItem(v);
              c.kind = vscode.CompletionItemKind.Variable;
              out.push(c);
            });

            json.result.types.map((t) => {
              const c = new vscode.CompletionItem(t);
              c.kind = vscode.CompletionItemKind.Class;
              out.push(c);
            });

            this.items[document.uri.toString()] = out;
          }

          res(this.items[document.uri.toString()]);
        });
      } else {
        rej();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { scheme: "file", language: "wgsl" },
      new WgslDocumentSymbolProvider()
    )
  );
  hasbin.first(["cargo-wgsl"], (res) => {
    if (res) {
      const validator = new Validator(res);
      context.subscriptions.push(vscode.Disposable.from(validator));

      const diagCol = vscode.languages.createDiagnosticCollection();
      const config = vscode.workspace.getConfiguration();

      if (config.get("wgsl.autocomplete") === true) {
        context.subscriptions.push(
          vscode.languages.registerCompletionItemProvider(
            "wgsl",
            new WgslCompletionItemProvider(validator)
          )
        );
      }

      context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
          lint(validator, doc, diagCol);
        })
      );

      if (config.get("shader.validateOnSave") === true) {
        context.subscriptions.push(
          vscode.workspace.onDidSaveTextDocument((doc) => {
            lint(validator, doc, diagCol);
          })
        );
      }

      if (config.get("shader.validateOnType") === true) {
        context.subscriptions.push(
          vscode.workspace.onDidChangeTextDocument((doc) => {
            lint(validator, doc.document, diagCol);
          })
        );
      }

      context.subscriptions.push(
        vscode.commands.registerCommand("shader.validateFile", () => {
          let document = vscode.window.activeTextEditor?.document;
          if (document) {
            lint(validator, document, diagCol);
          }
        })
      );

      // Validate on editor open
      let document = vscode.window.activeTextEditor?.document;
      if (document) {
        lint(validator, document, diagCol);
      }
    }
  });
}

function getSeverityFromString(severity: string): vscode.DiagnosticSeverity {
  switch(severity) {
    case "error": return vscode.DiagnosticSeverity.Error;
    case "warning": return vscode.DiagnosticSeverity.Warning;
    case "info": return vscode.DiagnosticSeverity.Information;
    case "hint": return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Error;
  }
}

function lint(
  validator: Validator,
  document: vscode.TextDocument,
  diagCol: vscode.DiagnosticCollection
) {
  if (document.languageId === "hlsl" || document.languageId === "wgsl") {
    validator.validateFile(document, document.languageId, (json) => {
      if (document !== null) {
        diagCol.delete(document.uri);

        if (!json) { return; }

        console.log("OK message");
        if (json.result.IsOk) {
          console.log("Linted file without errors.");
          vscode.window.showInformationMessage("No errors");
        } else if (json.result.Messages) {
          console.log("Received message");
          if (json.result.Messages.length > 0) {
            console.log("message hhas lenght");
            let diagnostics: vscode.Diagnostic[] = [];
            json.result.Messages.forEach((message) => {
              if (message.ParserErr) {
                vscode.window.showErrorMessage(JSON.stringify(json));
                let err = message.ParserErr;
      
                let start = new vscode.Position(err.line - 1, err.pos);
                let end = new vscode.Position(err.line - 1, err.pos);
                let diagnostic: vscode.Diagnostic = {
                  severity: getSeverityFromString(err.severity),
                  range: new vscode.Range(start, end),
                  message: err.error,
                  source: "cargo-wgsl",
                };
      
                diagnostics.push(diagnostic);
      
              } else if (message.ValidationErr) {
                let err = message.ValidationErr;
      
                let start = new vscode.Position(0, 0);
                let end = new vscode.Position(document.lineCount - 1, 0);
      
                let diagnostic: vscode.Diagnostic = {
                  severity: vscode.DiagnosticSeverity.Error,
                  range: new vscode.Range(start, end),
                  message: `${err.message}\n\n${err.debug}`,
                  source: "cargo-wgsl",
                };
      
                diagnostics.push(diagnostic);
      
              } else if (message.UnknownError) {
                let start = new vscode.Position(0, 0);
                let end = new vscode.Position(document.lineCount - 1, 0);
      
                let diagnostic: vscode.Diagnostic = {
                  severity: vscode.DiagnosticSeverity.Error,
                  range: new vscode.Range(start, end),
                  message: message.UnknownError,
                  source: "cargo-wgsl",
                };
      
                diagnostics.push(diagnostic);
      
              }
            });
            diagCol.set(document.uri, diagnostics);
          } else {
            console.log("Should expect error but no error found.");
          }
        }
      }
    });
  }
}

export function deactivate() {}
