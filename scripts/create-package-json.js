const {
  createProjectGraphAsync,
  readCachedProjectGraph,
  detectPackageManager,
  writeJsonFile,
} = require('@nx/devkit');
const {
  createLockFile,
  createPackageJson,
  getLockFileName,
} = require('@nx/js');
const { writeFileSync, mkdirSync } = require('fs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v ?? argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const project = args.project || args.p || args._[0]; // CLI > positional
  if (!project) {
    console.error(
      'Usage: node scripts/create-package-json.js --project <name> [--outDir <path>]'
    );
    process.exit(1);
  }
  const graph = readCachedProjectGraph() || (await createProjectGraphAsync());
  const node = graph.nodes[project];
  if (!node) {
    console.error(`Project "${project}" not found in Nx graph.`);
    process.exit(1);
  }

  const inferredOut = node.data?.targets?.build?.options?.outputPath;
  const outDir = args.outDir || args.o || inferredOut;
  if (!outDir) {
    console.error(
      'Pass --outDir or set build.options.outputPath on your project.'
    );
    process.exit(1);
  }
  const pkg = createPackageJson(project, graph, {
    isProduction: true,
    root: node.data.root,
  });
  const pm = detectPackageManager();
  const lock = createLockFile(pkg, graph, pm);
  mkdirSync(outDir, { recursive: true });
  writeJsonFile(`${outDir}/package.json`, pkg);
  writeFileSync(`${outDir}/${getLockFileName(pm)}`, lock, 'utf8');
  console.info(`✅ Wrote ${outDir}/package.json and pruned lockfile`);
}

main();
