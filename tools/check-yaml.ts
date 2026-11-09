// Parses every YAML file under scripts/defaults and reports the broken ones. Run: npm run check:yaml
import {readdirSync, readFileSync, statSync} from "fs";
import {join} from "path";
import {parse} from "yaml";

let bad = 0, count = 0;
const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.ya?ml$/.test(name)) { continue; }
        count++;
        try { parse(readFileSync(path, "utf8")); } catch (error) { bad++; console.log("BROKEN", path, (error as Error).message.split("\n")[0]); }
    }
};
walk(join(__dirname, "../scripts/defaults"));
console.log(`${count} files, ${bad} broken`);
process.exit(bad ? 1 : 0);
