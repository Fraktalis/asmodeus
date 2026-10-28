// Prints a new service token and the digest to put in asmodeus.yaml.
import { generateToken, hashToken } from "./tokens";

const token = generateToken();
console.log(`token:  ${token}\nsha256: ${hashToken(token)}`);
