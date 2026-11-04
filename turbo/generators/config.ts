import { PlopTypes } from "@turbo/gen";

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("example", {
    description:
      "An example Turborepo generator - creates a new file at the root of the project",
    prompts: [
      {
        type: "input",
        name: "file",
        message: "What is the name of the new file to create?",
        validate: (input: string) => {
          if (input.includes(".")) {
            return "file name cannot include an extension";
          }
          if (input.includes(" ")) {
            return "file name cannot include spaces";
          }
          if (!input) {
            return "file name is required";
          }
          return true;
        }
      },
      {
        type: "list",
        name: "type",
        message: "What type of file should be created?",
        choices: [".md", ".txt"]
      },
      {
        type: "input",
        name: "title",
        message: "What should be the title of the new file?"
      }
    ],
    actions: [
      {
        type: "add",
        path: "{{ turbo.paths.root }}/{{ dashCase file }}{{ type }}",
        templateFile: "templates/turborepo-generators.hbs"
      }
    ]
  });
  // Generate shared packages
   plop.setGenerator("package", {
    description: "Scaffold a new shared internal package with src/ structure",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "What is the name of the package? (e.g., math-utils)",
      },
    ],
    actions: [
      {
        type: "add",
        path: "packages/{{dashCase name}}/package.json",
        templateFile: "templates/package.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{dashCase name}}/tsconfig.json",
        templateFile: "templates/package-tsconfig.json.hbs",
      },
        // New action to generate the ESLint config file
      {
        type: "add",
        path: "packages/{{dashCase name}}/eslint.config.js",
        templateFile: "templates/package-eslint.config.js.hbs",
      },

      {
        type: "add",
        path: "packages/{{dashCase name}}/src/index.ts",
        templateFile: "templates/package-index.ts.hbs",
      },
    ],
  });
}
