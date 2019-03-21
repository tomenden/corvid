const io = require("socket.io-client");
const path = require("path");
const flat = require("flat");
const get_ = require("lodash/get");
const mapValues_ = require("lodash/mapValues");
const map_ = require("lodash/map");
const pickBy_ = require("lodash/pickBy");
const isArray_ = require("lodash/isArray");
const set_ = require("lodash/set");
const head_ = require("lodash/head");
const merge_ = require("lodash/merge");

const flatten = data => flat(data, { delimiter: path.sep, safe: true });
const unflatten = data =>
  flat.unflatten(data, { delimiter: path.sep, safe: true });

const getLocalServerURL = port => `http://localhost:${port}`;

const connectToLocalServer = port => {
  return new Promise((resolve, reject) => {
    const socket = io.connect(getLocalServerURL(port));

    const rejectConnection = reason => {
      socket.removeAllListeners();
      reject(new Error(reason));
    };

    const resolveConnection = () => {
      socket.removeAllListeners();
      resolve(socket);
    };

    socket.once("error", rejectConnection);
    socket.once("connect_error", rejectConnection);
    socket.once("connect_timeout", rejectConnection);
    socket.once("disconnect", rejectConnection);
    socket.once("connect", resolveConnection);
  });
};

const sendRequest = async (socket, event, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(event, payload, (err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });

const isCloneMode = async socket => sendRequest(socket, "IS_CLONE_MODE");

const updateSiteDocument = async (socket, siteDocument) =>
  sendRequest(socket, "UPDATE_DOCUMENT", siteDocument);

const updateCodeFiles = (socket, codeFileModifications) =>
  sendRequest(socket, "UPDATE_CODE", codeFileModifications);

const saveLocal = async (socket, siteDocument, codeFiles) => {
  await updateSiteDocument(socket, siteDocument);
  const codeFileChanges = calculateCodeFileChanges(codeFiles, siteDocument);
  await updateCodeFiles(socket, codeFileChanges);
  const currentCodeFiles = getCurrentCodeFiles(codeFiles);
  return {
    codeFiles: {
      previous: currentCodeFiles,
      current: currentCodeFiles
    }
  };
};

const getPageIdFromCodePath = filePath =>
  filePath.replace(/^.*[\\/]/, "").replace(/\.[^/.]+$/, "");

const isPageCodeFile = (filePath, siteDocument) => {
  const fileName = getPageIdFromCodePath(filePath);
  const page = get_(siteDocument, ["pages", fileName]);
  return filePath.startsWith("public/pages") && page;
};

const getPageCodeData = (path, siteDocument) => {
  const pageId = getPageIdFromCodePath(path);
  const page = get_(siteDocument, ["pages", pageId]);
  return {
    path,
    metaData: {
      pageId,
      pageTitle: get_(page, ["title"]),
      isPopUp: get_(page, ["isPopUp"])
    }
  };
};

const getFileData = (path, siteDocument) =>
  isPageCodeFile(path, siteDocument)
    ? getPageCodeData(path, siteDocument)
    : { path, metaData: {} };

const calculateCodeFileChanges = (codeFiles, siteDocument) => {
  const previousFlat = flatten(codeFiles.previous);
  const currentFlat = flatten(codeFiles.current);

  const modified = pickBy_(
    currentFlat,
    (currentContent, filePath) =>
      currentContent !== null &&
      !isArray_(currentContent) &&
      currentContent !== previousFlat[filePath]
  );

  const modifiedFiles = map_(modified, (content, path) =>
    merge_(getFileData(path, siteDocument), { content })
  );

  const deletedFiles = map_(
    pickBy_(currentFlat, currentContent => currentContent === null),
    (content, path) => getFileData(path, siteDocument)
  );

  const copiedFiles = Object.keys(currentFlat)
    .filter(targetPath => isArray_(currentFlat[targetPath]))
    .map(targetPath => ({
      sourcePath: getFileData(head_(currentFlat[targetPath]), siteDocument),
      targetPath: getFileData(targetPath, siteDocument)
    }));
  return {
    modifiedFiles,
    deletedFiles,
    copiedFiles
  };
};

const getCurrentCodeFiles = codeFiles => {
  const flattened = flatten(codeFiles.current);
  const withCopied = mapValues_(flattened, value =>
    isArray_(value) ? flattened[head_(value)] : value
  );
  const withoutDeleted = pickBy_(withCopied, content => content !== null);
  return unflatten(withoutDeleted);
};

const getCodeFilesFromServer = async socket => sendRequest(socket, "GET_CODE");
const getSiteDocumentFromServer = async socket =>
  sendRequest(socket, "GET_DOCUMENT");

const loadEditor = async (
  port,
  { siteDocument: remoteSiteDocument, siteCode: remoteSiteCode } = {}
) => {
  let siteDocument = remoteSiteDocument || {};
  let codeFiles = {
    previous: {},
    current: remoteSiteCode || {}
  };

  const socket = await connectToLocalServer(port);
  if (socket.connected) {
    const isInCloneMode = await isCloneMode(socket);
    if (isInCloneMode) {
      const saveResult = await saveLocal(socket, siteDocument, codeFiles);
      codeFiles = saveResult.codeFiles;
    } else {
      codeFiles.current = unflatten(await getCodeFilesFromServer(socket));
      siteDocument = await getSiteDocumentFromServer(socket);
    }
    socket.on("LOCAL_CODE_UPDATED", (action, ...args) => {
      switch (action) {
        case "add":
        case "change":
          modifyCodeFile(...args);
          break;
        case "delete":
          deleteCodeFile(...args);
          break;

        default:
          break;
      }
    });
  }

  const modifyCodeFile = (filePath, content) => {
    set_(codeFiles.current, filePath.split(path.sep), content);
  };

  const copyCodeFile = (sourcePath, targetPath) => {
    set_(codeFiles.current, targetPath.split(path.sep), [sourcePath]);
  };
  const deleteCodeFile = filePath => {
    set_(codeFiles.current, filePath.split(path.sep), null);
  };

  return {
    save: async () => {
      const saveResult = await saveLocal(socket, siteDocument, codeFiles);
      codeFiles = saveResult.codeFiles;
    },
    close: () => {
      if (socket && socket.connected) {
        socket.disconnect();
      }
    },
    isConnected: () => !!(socket && socket.connected),
    getSiteDocument: () => siteDocument,
    modifyDocument: newDocumnet => {
      siteDocument = newDocumnet;
    },
    getCodeFiles: () => getCurrentCodeFiles(codeFiles),
    modifyCodeFile,
    copyCodeFile,
    deleteCodeFile
  };
};

module.exports = loadEditor;
