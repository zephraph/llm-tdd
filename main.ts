import strip from "npm:strip-ansi";
import {
  Configuration,
  OpenAIApi,
  type CreateChatCompletionRequest,
} from "npm:openai";

const configuration = new Configuration({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});
const openai = new OpenAIApi(configuration);

const dbg = (
  prompt: CreateChatCompletionRequest
): CreateChatCompletionRequest => {
  prompt.messages.forEach((message) => {
    console.log("role", message.role);
    console.log(message.content);
  });
  return prompt;
};

interface ModuleResults {
  responseCode: string;
  testResults: string;
}

const genModuleFromTest = async (
  modulePath: string,
  testFile: string,
  results?: ModuleResults | null
) => {
  const response = await openai.createChatCompletion(
    dbg({
      model: "gpt-4o",
      messages: [
        {
          role: "system" as const,
          content: `
            You are tasked with creating the code for a Deno module that passes the following tests.
            Return only the code for the module, do not return any other text. Assume the name of the module
            you generate is imported from \`${modulePath}\`. Return only the code.
          `.trim(),
        },
        {
          role: "user" as const,
          content: `
          Here are the tests:

          ${testFile}
        `,
        },
      ].concat(
        !results
          ? []
          : [
              {
                role: "assistant" as "system",
                content: results.responseCode,
              },
              {
                role: "user" as const,
                content: `
                The tests failed with the following output:

                ${results.testResults}

                Please correct the code and return the updated code.
              `.trim(),
              },
            ]
      ),
    })
  );
  return response.data.choices[0].message?.content
    ?.replace(/^```typescript\n/, "")
    .replace(/\n```$/, "");
};

interface TestResult {
  status: "pass" | "fail";
  testResults?: string;
}

const runTests = async (testFilePath: string): Promise<TestResult> => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-import", testFilePath],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (result.success) {
    return {
      status: "pass",
    };
  }

  return {
    status: "fail",
    testResults: strip(new TextDecoder().decode(result.stdout)),
  };
};

const testFilePath = Deno.args[0];
if (!testFilePath || !Deno.lstatSync(testFilePath).isFile) {
  throw new Error(`Test file not found: ${testFilePath}`);
}

const modulePath = testFilePath.replace(/\.test\.ts$/, ".ts");
const testFile = await Deno.readTextFile(testFilePath);

let lastResult: ModuleResults | null = null;
if (Deno.lstatSync(modulePath).isFile) {
  const result = await runTests(testFilePath);
  if (result.status === "pass") {
    console.log("Module already passes tests");
    Deno.exit(0);
  } else {
    lastResult = {
      responseCode: Deno.readTextFileSync(modulePath),
      testResults: result.testResults!,
    };
  }
}

let attempts = 0;
while (true) {
  if (attempts++ >= 3) {
    throw new Error(`Failed to generate code after ${attempts} attempts`);
  }

  const code = await genModuleFromTest(modulePath, testFile, lastResult);

  if (!code) {
    throw new Error("No code generated");
  }

  Deno.writeTextFileSync(modulePath, code);

  const result = await runTests(testFilePath);
  if (result.status === "pass") {
    console.log("Tests passed!");
    break;
  } else {
    if (!result.testResults) {
      throw new Error("No test results");
    }
    lastResult = {
      responseCode: code!,
      testResults: result.testResults!,
    };
  }
}
