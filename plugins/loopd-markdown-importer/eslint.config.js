export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        figma: "readonly",
        console: "readonly",
        __html__: "readonly",
        __uiFiles__: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { 
        "varsIgnorePattern": "^_",
        "argsIgnorePattern": "^_|^e$|^err$|^error$"
      }],
      "no-undef": "error",
      "semi": ["warn", "always"],
      "no-console": "off"
    }
  }
];
