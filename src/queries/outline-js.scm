; nit's outline for JavaScript and TypeScript: what a reader scans a file by. Declarations,
; classes and their members, top-level constants, and test blocks named by their string.
; Object-literal properties and locals inside functions are left out on purpose.

(function_declaration name: (identifier) @name) @item.function
(generator_function_declaration name: (identifier) @name) @item.function
(class_declaration name: (_) @name) @item.class
(method_definition name: (_) @name) @item.method

; Top-level `const`/`let`/`var`, exported or not. A function value makes it a function.
(program (lexical_declaration (variable_declarator name: (identifier) @name) @item.variable))
(program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name) @item.variable)))
(program (variable_declaration (variable_declarator name: (identifier) @name) @item.variable))
(program (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @item.function))
(program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @item.function)))

; describe("…") / it("…") / test.each(…)("…") style blocks.
((call_expression
   function: [(identifier) @fn (member_expression object: (identifier) @fn)]
   arguments: (arguments . [(string) (template_string)] @name)) @item.test
 (#match? @fn "^(describe|context|suite|it|test|bench)$"))
