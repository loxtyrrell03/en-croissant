import { commands } from "@/bindings";
import { enginePreferences } from "./enginePreferences";
import { stockfishUpgradeNative } from "./stockfishUpgrade";
import { createStockfishCatalogInstall } from "./stockfishCatalogInstall";
import { unwrap } from "./unwrap";

export const stockfishCatalog = createStockfishCatalogInstall({
    directory: stockfishUpgradeNative.directory,
    loadedDirectory: enginePreferences.getLoadedContext,
    saved: enginePreferences.isSavedValue,
    available: stockfishUpgradeNative.available,
    install: async (id, directory) => unwrap(await commands.installStockfish19(id, directory)),
    cancel: async (id) => unwrap(await commands.cancelStockfish19Install(id)),
    flush: enginePreferences.flush,
    retrySave: enginePreferences.retry,
});
