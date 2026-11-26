const base = (Bun.env.TMPDIR ?? "/tmp").replace(/\/+$/, "");
const configPath = `${base}/spectre-test-gitconfig-${process.pid}`;

await Bun.write(configPath, "[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n");

for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"] as const) {
  delete Bun.env[key];
  delete process.env[key];
}

Bun.env.GIT_CONFIG_GLOBAL = configPath;
Bun.env.GIT_CONFIG_NOSYSTEM = "1";
