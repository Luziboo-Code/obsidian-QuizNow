import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * Runs the same ruleset as Obsidian's automated community-plugin review
 * (`eslint-plugin-obsidianmd` recommended config), so review findings are caught
 * locally before publishing a release.
 */
export default defineConfig([
	{
		// 构建/发版脚本属于开发工具，不随插件发布，不参与插件代码规范检查
		ignores: [
			"main.js",
			"node_modules/**",
			"versions.json",
			"esbuild.config.mjs",
			"version-bump.mjs",
		],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*", "esbuild.config.mjs"],
				},
			},
		},
	},
]);
