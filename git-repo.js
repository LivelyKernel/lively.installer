import { exec } from "./shell-exec.js";

async function test() {

  var repo = new Repository("/Users/robert/Lively/lively-dev/lively.modules")
  repo.currentBranch()
  repo.hasLocalChanges();
  repo.localBranchInfo()
  await repo.hasRemoteChanges();

}

function parentdir(dir) {
  return dir.split("/").slice(0,-1).join("/");
}

function dirname(dir) {
  var pathParts = dir.split("/");
  return pathParts[pathParts.length-1];
}

export class Repository {

  constructor(directory, options = {dryRun: false, log: []}) {
    this.directory = directory;
    this.dryRun = options.dryRun;
    this._log = options.log || [];
  }

  cmd(cmdString, opts) {
    opts = Object.assign({cwd: this.directory, log: this._log}, opts);
    opts.log = opts.log || this._log;
    return exec(cmdString, opts);
  }

  log() { return this._log.join(""); }


  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // status
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  async currentBranch() {
    var {output} = await this.cmd('git branch -q | grep "*"');
    return output.trim().replace(/^\*\s*/, "");
  }

  async hasLocalChanges() {
    var {output, code} = await this.cmd(`git status --short -uno`);
    return !!output.trim().length;
  }

  async diff(opts = []) {
    var {output} = await this.cmd(`git diff ${opts.join(" ")}`);
    return output.trim();
  }


  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // branches
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  async localBranchInfo() {
    // await new Repository().localBranchInfo()
    // var i = new Repository()
    // i.localBranchInfo()
    // i.log()
    // Returns {branch, remote}
    var {output: ref, code} = await this.cmd("git symbolic-ref HEAD");
    var branch = code ? undefined : ref.trim().slice(ref.lastIndexOf('/')+1);
    return {
      branch: branch,
      remote: branch ? await this.remoteOfBranch(branch) : undefined,
      hash: (await this.cmd("git rev-parse HEAD")).output.trim()
    }
  }

  async remoteOfBranch(branch) {
    var {output} = await this.cmd(`git config branch.${branch}.remote`);
    return output.trim();
  }

  async checkout(branchOrHash) {
    var {output, code} = this.cmd(`git checkout ${branchOrHash}`);
    if (code) throw new Error(`Failed to checkout ${branchOrHash}: ${output}`);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // remote
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  async getListOfRemotes() {
    var {output: remotesString} = await this.cmd("git remote -v");
    return remotesString.split('\n').map(string => {
      string = string.trim();
      if (!string.length || string.match(/\(fetch\)$/)) return null;
      var parts = string.split(/\s+/);
      return {name: parts[0], url: parts[1]};
    }).filter(ea => !!ea);
  }

  async interactivelyChooseRemote() {
    // await new Repository().getListOfRemotes()
    // await new Repository().interactivelyChooseRemote()
    var remotes = await this.getListOfRemotes(),
        choice = await $world.listPrompt(
          `Please select a git remote repository.`,
          remotes.map(function(remote) {
            return {
              isListItem: true,
              string: remote.name + ' (' + remote.url + ')',
              value: remote
            };
          }), 'origin', pt(350, 140));

    if (!choice || choice.length === 0 || !choice.name)
      return undefined;

    // {name, url}
    return choice;
  }

  async hasRemoteChanges(branch = "master") {
    var {local, remote} = await this.getRemoteAndLocalHeadRef(branch);
    return local !== remote;
  }

  async getRemoteAndLocalHeadRef(branch = "master", remote = "origin") {
    var cmdString =
        `remote=$(git ls-remote "${remote}" ${branch});\n`
      + `local=$(git show-ref --hash ${branch} | head -n 1);\n`
      + `echo "{\\"remote\\": \\"$remote\\", \\"local\\": \\"$local\\"}";`;

    var {output} = await this.cmd(cmdString);

    if (output.match(/does not exist/)) {
      return {remote: '', local: this.directory + ' does not exist'};
    }

    var out;
    try {
      out = JSON.parse(output.replace(/\s/g, ' '));
    } catch (e) {
      throw new Error(output)
    }

    return {
      remote: (out.remote || '').trim().split(' ')[0],
      local: (out.local || '').trim().split(' ')[0]};
  }

  async push() {
    var {remote, branch} = await this.localBranchInfo()
    if (!remote) throw new Error(`No remote for pushing ${this.directory}`);
    if (!branch) throw new Error(`No branch for pushing ${this.directory}`);
    return this.cmd(`git push "${remote}" "${branch}"`);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // commit
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  commit(message, all = false) { return this.cmd(`git commit -${all ? "a" : ""}m '${message}'`); }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // local commit state
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  async fileStatus(options) {
    /*
    var results = await new Repository("/Users/robert/Lively/LivelyKernel2").fileStatus()
    */

    options = options || {};

    var self = this,
        fileObjects = await fileStatus(this.directory);
    fileObjects = fileObjects.map(addFilenameAndChange);
    return fileObjects;

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

    async function fileStatus(dir, next) {
      var {code, output} = await self.cmd("git status --porcelain");
      if (code) throw new Error("git status failed: " + output);
      var lines = output.split('\n');
      var results = lines && lines.reduce(function(lines, line) {
        if (!line) return lines;
        var m, results = lines;
        if (m = line.match(/^(\s[A-Z]|[A-Z]{2})(.*)/)) results.push({status: "unstaged",  statusString: m[0]});
        if (m = line.match(/^[A-Z]{1,2}(.*)/))         results.push({status: "staged",    statusString: m[0]});
        if (m = line.match(/^\s*\?\?(.*)/))            results.push({status: "untracked", statusString: m[0]});
        return results;
      }, []).filter(ea => !!ea);
      return results
    }

    function addFilenameAndChange(fileObject) {
        // statusString looks like "R  bar.txt -> foo.txt"
        //        +o   ' ' = unmodified
        //        +o    _M = modified
        //        +o    _A = added
        //        +o    _D = deleted
        //        +o    _R = renamed
        //        +o    _C = copied
        //        +o    _U = updated but unmerged
        //
        //        Ignored files are not listed, unless --ignored option is in effect, in
        //        which case XY are !!.
        //
        //            X          Y     Meaning
        //            -------------------------------------------------
        //                      [MD]   not updated
        //            M        [ MD]   updated in index
        //            A        [ MD]   added to index
        //            D         [ M]   deleted from index
        //            R        [ MD]   renamed in index
        //            C        [ MD]   copied in index
        //            [MARC]           index and work tree matches
        //            [ MARC]     M    work tree changed since index
        //            [ MARC]     D    deleted in work tree
        //            -------------------------------------------------
        //            D           D    unmerged, both deleted
        //            A           U    unmerged, added by us
        //            U           D    unmerged, deleted by them
        //            U           A    unmerged, added by them
        //            D           U    unmerged, deleted by us
        //            A           A    unmerged, both added
        //            U           U    unmerged, both modified
        //            -------------------------------------------------
        //            ?           ?    untracked
        //            !           !    ignored
        //            -------------------------------------------------

        var statusString = fileObject.statusString,
            type= fileObject.status,
            change = '',
            fileName = statusString.slice(3),
            statusFlags = statusString.slice(0,2), // git status --porcelain format
            statusFlagIndex = statusFlags[0],
            statusFlagWorkTree = statusFlags[1],
            statusFlag = type === 'unstaged' ? statusFlagWorkTree : statusFlagIndex;

        // for unmerged changes the status flags can be interpreted as follows:
        if (statusFlags ==="DD") change = "unmerged, deleted locally and remotely";
        else if (statusFlags ==="AU") change = "unmerged, added locally and modified remotely";
        else if (statusFlags ==="UD") change = "unmerged, modified locally and deleted remotely";
        else if (statusFlags ==="UA") change = "unmerged, modified locally and added remotely";
        else if (statusFlags ==="DU") change = "unmerged, deleted locally and modified remotely";
        else if (statusFlags ==="AA") change = "unmerged, added locally and remotely";
        else if (statusFlags ==="UU") change = "unmerged, modified locally and remotely";
        else if (statusFlag === "M") change = 'modfied';
        else if (statusFlag === "R") change = 'renamed';
        else if (statusFlag === "C") change = 'copied';
        else if (statusFlag === "A") change = 'added';
        else if (statusFlag === "D") change = 'deleted';

        if (change === 'renamed' || change === 'copied')
          fileName = fileName.split('->').last().trim();

        fileObject.change = change;
        fileObject.fileName = fileName;
        return fileObject;
    }

  }

  async add(files) {
    // files = {fileName}
    return this.cmd(`git add ${files.map(ea => typeof ea === "string" ? ea : ea.fileName).join(" ")}`);
  }

  async stageOrUnstageOrDiscardFiles(action, fileObjects, options) {
    // action = "stage" || "unstage"
    // fileObjects come from git.fileStatus and should have a fileName and status property
    // patches should be lively.ide.FilePatch objects
    // EITHER fileObjects or patches are needed. patches take precdence

    console.assert(action === "stage" || action === "unstage" || action === "discard", action + " is not expected action");
    console.assert(fileObjects, "stageOrUnstage needs file status objects");

    options = options || {};

    var filter;
    if (action === "stage") filter = function(fo) { return fo.status === "unstaged"; };
    if (action === "unstage") filter = function(fo) { return fo.status === "staged"; };
    if (action === "discard") filter = function(fo) { return true; };

    var cmdGroups = fileObjects.reduce(function(cmds, fo) {
      if (!filter(fo))  return cmds;
      var groups = [];
      if (action === "unstage" || action === "discard") groups.push(cmds.reset);
      if (action === "discard") groups.push(cmds.checkout);
      if ((action === "unstage" || action === "discard") && fo.status === "staged" && fo.change === 'added') groups.push(cmds.rmCached);
      if (action === "stage" && fo.status === "unstaged" && fo.change === 'deleted') groups.push(cmds.rm);
      else if (action === "stage") groups.push(cmds.add);
      groups.invoke("push", fo.fileName);
      return cmds;
    }, {checkout: [], reset: [], rmCached: [], rm: [], add: []});

    var commands = [];
    if (cmdGroups.rm.length)       commands.push({name: "rm",       gitCommand: "git rm -- "          + cmdGroups.rm.join(" ")});
    if (cmdGroups.rmCached.length) commands.push({name: "rm",       gitCommand: "git rm --cached -- " + cmdGroups.rmCached.join(" ")});
    if (cmdGroups.add.length)      commands.push({name: "add",      gitCommand: "git add -- "         + cmdGroups.add.join(" ")});
    if (cmdGroups.reset.length)    commands.push({name: "reset",    gitCommand: "git reset -- "       + cmdGroups.reset.join(" ")});
    if (cmdGroups.checkout.length) commands.push({name: "checkout", gitCommand: "git checkout -- "    + cmdGroups.checkout.join(" ")});

    for (let cmd of commands) {
      var {code, output} = await this.cmd(cmd.gitCommand);
      if (code) throw new Error(`Error when trying to do git ${cmd.name}: ${output}`);
    }

  }

  stash() { return this.cmd("git stash"); }
  stashPop() { return this.cmd("git stash pop"); }

  commit(message, all = false) {
    if (!message) throw new Error("No commit message");
    return this.cmd(`git commit ${all ? "-a" : ""} -m "${message}"`);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // pull / fetch
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  pull(branch = "master", remote = "origin") {
    return this.cmd(`git pull ${remote} ${branch}`);
  }

  async interactivelyUpdate(branch = "master", remote = "origin") {
    var current = await this.localBranchInfo();
    var trackedRemote = await this.remoteOfBranch(branch);
    if (trackedRemote) remote = trackedRemote;

    if (!await this.hasRemoteChanges(branch)) {
      false && console.log(`No remote changes, ${this.directory} is up-tp-date.`)
      return "up-to-date";
    }

    console.log(`Updating ${this.directory} from git ${remote}/${branch}`)
    var stashed = false;
    if (await this.hasLocalChanges()) {
      console.log(`Stashing local changes...`);
      stashed = true;
      let {code, output} = await this.stash();
      if (code !== 0) throw new Error("Error in stash: " + output);
    }

    // in case we are switching to a new branch that isn't local yet we need to
    // fetch before checkout!
    await this.cmd(`git fetch ${remote}`)

    if (current.branch !== branch) await this.checkout(branch);

    var {code, output: pullOutput} = await this.pullSavingUntrackedFiles(branch, remote);
    if (code !== 0) throw new Error("Error in pull: " + pullOutput);

    if (current.branch !== branch) await this.checkout(current.branch || current.hash);

    if (stashed) {
      let {code, output} = await this.stashPop();
      if (code !== 0) throw new Error("Error in stash pop: " + output);
      console.log(`Local changes from stash restored...`);
    }

    return pullOutput;
  }

  async moveFilesElsewhereWhile(files, func) {
    var fileObjs = files.map(f => {
      var parts = f.split("/"),
          dir = parts.slice(0, -1).join("/"),
          name = parts[parts.length-1];
      return {path: f, name, dir}
    });

    for (let f of fileObjs)
      await this.cmd(`mkdir -p .lively-git-helper/${f.dir}; mv ${f.path} .lively-git-helper/${f.path};`)

    try {
      return await func();
    } finally {

      for (let f of fileObjs)
        await this.cmd(`mv .lively-git-helper/${f.path} ${f.path};`)
    }

  }

  async pullSavingUntrackedFiles(branch, remote) {
    var initialPull = await this.pull(branch, remote);
    if (!initialPull.code) return initialPull;

    // if the pull doesn't succeed check if we have files that would be overridden
    var untrackedRe = /untracked working tree files would be overwritten/;
    if (!initialPull.output.match(untrackedRe)) return initialPull;

    var lines = initialPull.output.trim().split("\n"),
        index = lines.findIndex((line) => line.match(untrackedRe)),
        overwrittenFiles = lines.slice(index+1)
                            .filter(line => line.match(/^\s/))
                            .map(line => line.trim())

    var pullCmd = this.moveFilesElsewhereWhile(overwrittenFiles, async () => await this.pull(branch, remote));
    if (pullCmd.code !== 0) throw new Error("Error in pull:" + pullCmd.output);
    return pullCmd;
  }


  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // repo creation
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  async clone(repoURL, branch = "master") {
    if ((await this.cmd(`test -d "${this.directory}"`)).code === 0) {
      throw new Error(`Cannot clone into ${this.directory}: exists already`);
    }
    var cmd = await this.cmd(`git clone -b ${branch} ${repoURL} ${dirname(this.directory)}`, {cwd: parentdir(this.directory)});
    if (cmd.code) throw new Error(`Failure cloning repo: ${cmd.output}`);
    return cmd;
  }

  async init(optRepoURL) {
    var {code, output} = await this.cmd(`mkdir -p ${this.directory}`, {cwd: parentdir(this.directory)});
    if (code) {
      throw new Error(`Could not initialize new git repo, creating a directory failed: ${this.directory}, ${output}`)
    }
    var cmd = await this.cmd(`git init`);
    if (cmd.code) throw new Error(`Failure cloning repo: ${cmd.output}`);
    if (optRepoURL) {
      await this.cmd(`git remote add origin "${optRepoURL}"`);
    }
    return cmd;
  }

}
