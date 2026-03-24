import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";

export default {
	input: "src/plugin.ts",
	output: {
		file: "com.janoskehl.printer-status.sdPlugin/bin/plugin.js",
		format: "esm",
		sourcemap: true,
	},
	plugins: [
		typescript({
			mapRoot: path.resolve("com.janoskehl.printer-status.sdPlugin/bin"),
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true,
		}),
		commonjs(),
	],
};
