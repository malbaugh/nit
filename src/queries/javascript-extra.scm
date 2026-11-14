; nit additions: top-level constants (`const X = …`, exported or not). Local variables stay out.

(program
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator
        name: (identifier) @name) @definition.constant)))
