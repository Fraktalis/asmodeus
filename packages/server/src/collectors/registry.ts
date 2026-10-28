import type { CollectorType } from "@asmodeus/contracts";
import { uptimeKumaType } from "./uptime-kuma";
import { vikunjaType } from "./vikunja";

/** Every built-in collector type (ADR-0003). */
export const registry: CollectorType<any>[] = [uptimeKumaType, vikunjaType];
