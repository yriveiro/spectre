const base = (Bun.env.TMPDIR ?? "/tmp").replace(/\/+$/, "");
const configPath = `${base}/spectre-test-gitconfig-${process.pid}`;

await Bun.write(configPath, "[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n");

Bun.env.GIT_CONFIG_GLOBAL = configPath;
Bun.env.GIT_CONFIG_NOSYSTEM = "1";
