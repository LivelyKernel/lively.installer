import { exec } from "./shell-exec.js";
import { join, read } from "./helpers.js";
import { Repository } from "./git-repo.js";

export class Package {

  constructor(dir, config = {}) {
    config = Object.assign({name: "", repoURL: "", branch: "master"}, config);
    this.directory = dir;
    this.config = config;
  }

  get version() { return this.config.version || null; }
  get name() { return this.config.name || ""; }
  get dependencies() {
    return Object.assign({}, this.config.dependencies, this.config.devDependencies);
  }

  async readConfig() {
    try {
      var content = await read(join(this.directory, "package.json"));
      if (content) this.config = Object.assign(this.config, JSON.parse(content));
    } catch (e) {
      console.warn(`Error when reading package config for ${this.directory}: ${e}`)
    }
    return this;
  }

  async exists() {
    return (await exec(`node -e 'process.exit(require("fs").existsSync("${this.directory}") ? 0 : 1);'`)).code === 0;
  }

  async ensure(log = []) {
    if (!(await this.exists()))
      await this.repo().clone(this.config.repoURL, this.config.branch, log);
    return this;
  }

  async update(log = []) {
    if (await this.exists())
      await this.repo().interactivelyUpdate(this.config.branch, undefined, log);
    return this;
  }

  repo() {
    return new Repository(this.directory)
  }  

  findDependenciesIn(packages) {
    var deps = Object.keys(this.dependencies);
    return packages.filter((p) => deps.indexOf(p.name) > -1);
  }

  async symlinkTo(localDir, toPackage) {
    // creates a link from this.directory -> toPackage.directory/localDir/this.name
    var fromPackage = this;
    var cmd = await exec(`node -e '
var j = require("path").join, fs = require("fs"), localDir = "${localDir}", linkedDir = j(localDir, "${fromPackage.name}");
if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);
if (fs.existsSync(linkedDir)) rm(linkedDir);
fs.symlinkSync("${fromPackage.directory}", linkedDir, "dir");
function rm(path) {
    var stat = fs.lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.readdirSync(path).forEach(f => rm(j(path, f)));
    fs.rmdirSync(path);
    } else fs.unlinkSync(path);
}
'`, {cwd: toPackage.directory});
    return cmd;
  }

  async npmInstall(log = []) {
    return exec("npm install", {log: log, cwd: this.directory});
  }
}


function test() {
  var p = new Package("/Users/robert/Lively/LivelyKernel2/packages/lively.installer")
  p.readConfig()
  p.version
  p.repo()
}