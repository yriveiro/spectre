import { describe, expect, test } from "bun:test";
import { startMock } from "../mock";
import { loadScenario } from "../scenario";

const scenario = await loadScenario(`${import.meta.dir}/../scenarios/correction.json`);

describe("the mock provider is behind the run token", () => {
  test("a request without the token is not found", async () => {
    const mock = startMock(scenario);
    try {
      const response = await fetch(`http://127.0.0.1:${mock.port}/v1/models`);
      expect(response.status).toBe(404);
    } finally {
      mock.stop();
    }
  });

  test("a request with the token answers the model list", async () => {
    const mock = startMock(scenario);
    try {
      const response = await fetch(`http://127.0.0.1:${mock.port}/${mock.token}/v1/models`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        object: "list",
        data: [{ id: "resume", object: "model" }],
      });
    } finally {
      mock.stop();
    }
  });
});
