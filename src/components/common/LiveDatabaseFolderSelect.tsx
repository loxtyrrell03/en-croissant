import { useSWRConfig } from "swr";
import DatabaseFolderSelect, { type DatabaseFolderSelectProps } from "./DatabaseFolderSelect";
import { getDatabases } from "@/utils/db";

/** Refresh the shared native catalogue when opened, including consumers whose
 * existing SWR entry was registered with immutable data. */
export default function LiveDatabaseFolderSelect(props: DatabaseFolderSelectProps) {
    const { mutate } = useSWRConfig();
    return <DatabaseFolderSelect {...props} onRefresh={() => mutate("databases", getDatabases(), { revalidate: false, rollbackOnError: true, throwOnError: true })} />;
}
