import { describeStoreConformance } from "./store-conformance";
import { openSqliteStore } from "../src/store/sqlite";

describeStoreConformance("sqlite", async () => openSqliteStore(":memory:"));
