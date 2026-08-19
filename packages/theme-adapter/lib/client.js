window.__ModuleLoader__.load({
	id: "@openma/dsh-agents-plugins-bridge-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client.ts
		const inject = ["theme"];
		/** Register package-owned themes as one disposable client contribution. */
		function apply(ctx, config) {
			if (!Array.isArray(config.themes)) throw new TypeError("plugin bridge theme config requires a themes array");
			const disposers = [];
			try {
				for (const definition of config.themes) disposers.push(ctx.theme.register(definition));
			} catch (error) {
				for (const dispose of disposers.reverse()) dispose();
				throw error;
			}
			return () => {
				for (const dispose of disposers.reverse()) dispose();
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map