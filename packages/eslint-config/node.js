import baseConfig from "./base.js";

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  }
];
