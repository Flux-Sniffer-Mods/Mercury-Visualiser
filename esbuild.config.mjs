import esbuild from "esbuild";
import process from "node:process";

const banner = `/*
Mercury Visualiser — bundled with esbuild.
Source: https://github.com/Flux-Sniffer-Mods/Mercury-Visualiser
*/
`;

const prod = process.argv[2] === "production";

/**
 * Resolves `inline-worker:<path>` imports by bundling the referenced file as a
 * stand-alone IIFE and exporting its source as a string, so the layout worker
 * ships inside main.js (Obsidian plugins are a single script).
 */
const inlineWorkerPlugin = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^inline-worker:/ }, (args) => ({
			path: new URL(args.path.slice("inline-worker:".length), `file://${args.resolveDir}/`).pathname,
			namespace: "inline-worker",
		}));
		build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				write: false,
				format: "iife",
				target: "es2020",
				minify: prod,
				logLevel: "silent",
			});
			return {
				contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
				loader: "js",
				watchFiles: [args.path],
			};
		});
	},
};

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
	plugins: [inlineWorkerPlugin],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
