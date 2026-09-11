import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  PROJECT_ENVIRONMENT_MAX_KEYS,
  PROJECT_ENVIRONMENT_MAX_BYTES,
} from "./project-environment-limits";

export const hostContract = defineRpcContract({
  prepareProjectEnvironment: {
    input: z
      .object({
        entries: z
          .array(
            z
              .object({
                key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
                value: z.string().max(PROJECT_ENVIRONMENT_MAX_BYTES),
              })
              .strict(),
          )
          .max(PROJECT_ENVIRONMENT_MAX_KEYS),
      })
      .strict(),
    output: z.object({ path: z.string() }).strict(),
  },
});
