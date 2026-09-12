import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// 发布新版本时同步 manifest.json 与 versions.json：
// Obsidian 要求 GitHub Release 的 tag 与 manifest.version 完全一致，
// 并在用户 Obsidian 版本低于 minAppVersion 时查阅 versions.json 回退到兼容版本。
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
