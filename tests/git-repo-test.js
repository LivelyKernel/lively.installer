/*global describe, it, beforeEach, afterEach, __dirname, System*/

import { expect } from "mocha-es6";
import { Repository } from "../git-repo.js";
import { exec } from "../shell-exec.js";

var isNode = System.get("@system-env").node;
var testDir = isNode ?
  __dirname + "/tests" :
  lively.shell.WORKSPACE_LK + "/node_modules/lively.installer/tests";

function writeFile(path, content) {
  return isNode ?
    new Promise((resolve, reject) =>
      System._nodeRequire("fs").writeFile(path, content, (err) =>
        err ? reject(err) : resolve())) :
    lively.shell.writeFile(path, content);
}

function readFile(path, content) {
  return isNode ?
    new Promise((resolve, reject) =>
      System._nodeRequire("fs").readFile(path, content, (err, content) =>
        err ? reject(err) : resolve(String(content)))) :
    lively.shell.readFile(path).then(cmd => {
      if (cmd.code) throw new Error(cmd.output);
      return cmd.output
    })
}

async function mkdir(path) {
  if (isNode) {
    try {
      System._nodeRequire("fs").mkdirSync(path)
    } catch (e) {}
    return Promise.resolve();
  } else {
    return await lively.shell.run(`mkdir -p ${path}`);
  }
}

function removeDir(dir) {
  return exec(`rm -rf ${dir}`)
}

const DELETE = {}
async function writeFiles(currentDir, fileSpec, rootDir) {
  if (!rootDir) rootDir = currentDir;
  var files = [];
  for (var name in fileSpec) {
    var path = currentDir + "/" + name;
    if (fileSpec[name] === DELETE) {
      removeDir(path);
      files.push({fileName: path.slice(rootDir.length).replace(/^\//, ""), change: "deleted"});
    } else if (typeof fileSpec[name] === "object") {
      await mkdir(path);
      files = files.concat(await writeFiles(path, fileSpec[name], rootDir));
    } else {
      await writeFile(path, String(fileSpec[name]));
      files.push({fileName: path.slice(rootDir.length).replace(/^\//, ""), change: "changed"});
    }
  }
  return files
}

async function writeAndCommit(repo, fileSpec) {
  var files = await writeFiles(repo.directory, fileSpec);
  await repo.add(files);
  await repo.commit("auto commit");
  return files;
}

    // await removeDir(repo1.directory);

    // var {output} = await repo1.cmd("git show HEAD")
    
    // repo1.log()
    // await repo1.stageOrUnstageOrDiscardFiles("stage", files.map(ea => ({fileName: ea})))
    // await writeFile(repo1.directory + "/test.txt", "fooo")

describe("repo operations", () => {

  var repo1Dir = testDir + "/new-git-repo-1",
      repo2Dir = testDir + "/new-git-repo-2",
      repo1, repo2;

  beforeEach(async () => {
    repo1 = new Repository(repo1Dir);
    repo2 = new Repository(repo2Dir);
  });

  afterEach(async () => {
    await await removeDir(repo1Dir);
    await await removeDir(repo2Dir);
  });

  it("repo can be created, cloned and files committed", async () => {
    var {output} = await repo1.init();
    expect(output).match(/initialized/i);

    // commit stuff
    await writeAndCommit(repo1, {"test.x" : "hello", "test.y" : "world", dir: {"test.z": "123123123"}})
    await writeAndCommit(repo1, {"test.x" : "hello", "test.y" : DELETE, dir: {"test.z": "123123123"}})

    // check repo status + commits
    expect(await repo1.fileStatus()).to.equal([]);
    expect((await repo1.cmd("git log --oneline")).output.trim().split("\n")).to.have.length(2);

    // clone a new repo
    var repo2 = new Repository(repo2Dir),
        {output} = await repo2.clone(`file://${repo1Dir}`);
    
    // test state
    expect((await readFile(`${repo2Dir}/test.x`))).equals("hello\n");
    try {
      var content = await readFile(`${repo2Dir}/test.y`)
      expect.fail(content, null, "was able to read test.y that should't exist")
    } catch (e) {}
  });

  describe("file conflict", () => {

    beforeEach(async () => {
      await repo1.init();
      await writeAndCommit(repo1, {"test.x" : "hello"})
      await repo2.clone(`file://${repo1Dir}`);
    });
    
    it("normal pull creates conflict", async () => {
      await writeAndCommit(repo1, {"test.x" : "123"})
      await writeAndCommit(repo2, {"test.x" : "foo bar"})
      var {output} = await repo2.pull();
      expect(output).match(/CONFLICT \(content\): Merge conflict in test.x/)
      expect((await readFile(`${repo2Dir}/test.x`))).match(/123\n=======\nfoo bar\n>>>>>>> auto commit/);
    });

    it("save pull doesnt create messed up files", async () => {
      await writeAndCommit(repo1, {"test.x" : "123"})
      await writeAndCommit(repo2, {"test.x" : "foo bar"})
      var {output} = await repo2.pull();
      expect(output).match(/CONFLICT \(content\): Merge conflict in test.x/)
      expect((await readFile(`${repo2Dir}/test.x`))).equals("foo bar\n");
    });

  });

});
