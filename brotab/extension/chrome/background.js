/*
On startup, connect to the "brotab_mediator" app.
*/

const GET_WORDS_SCRIPT = '[...new Set(document.body.innerText.match(/\\w+/g))].sort().join("\\n");';
const GET_TEXT_SCRIPT = 'document.body.innerText.replace(/\\n|\\r|\\t/g, " ");';


class BrowserTabs {
  constructor(browser) {
    this._browser = browser;
  }

  list(queryInfo, onSuccess) {
    throw new Error('list is not implemented');
  }

  close(tab_ids, onSuccess) {
    throw new Error('close is not implemented');
  }

  move(tabId, moveOptions, onSuccess) {
    throw new Error('move is not implemented');
  }

  create(createOptions, onSuccess) {
    throw new Error('create is not implemented');
  }

  activate(tab_id) {
    this._browser.tabs.update(tab_id, {'active': true});
  }

  getActive(onSuccess) {
    throw new Error('getActive is not implemented');
  }

  runScript(tab_id, script, payload, onSuccess, onError) {
    throw new Error('runScript is not implemented');
  }

  getBrowserName() {
    throw new Error('getBrowserName is not implemented');
  }
}

class FirefoxTabs extends BrowserTabs {
  list(queryInfo, onSuccess) {
    this._browser.tabs.query(queryInfo).then(
      onSuccess,
      (error) => console.log(`Error listing tabs: ${error}`)
    );
  }

  close(tab_ids, onSuccess) {
    this._browser.tabs.remove(tab_ids).then(
      onSuccess,
      (error) => console.log(`Error removing tab: ${error}`)
    );
  }

  move(tabId, moveOptions, onSuccess) {
    this._browser.tabs.move(tabId, moveOptions).then(
      onSuccess,
      // (tab) => console.log(`Moved: ${tab}`),
      (error) => console.log(`Error moving tab: ${error}`)
    );
  }

  create(createOptions, onSuccess) {
    this._browser.tabs.create(createOptions).then(
      onSuccess,
      (error) => console.log(`Error: ${error}`)
    );
  }

  getActive(onSuccess) {
    this._browser.tabs.query({active: true}).then(
      onSuccess,
      (error) => console.log(`Error: ${error}`)
    );
  }

  runScript(tab_id, script, payload, onSuccess, onError) {
    this._browser.tabs.executeScript(tab_id, {code: script}).then(
      (result) => onSuccess(result, payload),
      (result) => onError(result, payload)
    );
  }

  getBrowserName() {
      return "firefox";
  }
}

class ChromeTabs extends BrowserTabs {
  list(queryInfo, onSuccess) {
    this._browser.tabs.query(queryInfo, onSuccess);
  }

  close(tab_ids, onSuccess) {
    this._browser.tabs.remove(tab_ids, onSuccess);
  }

  move(tabId, moveOptions, onSuccess) {
    this._browser.tabs.move(tabId, moveOptions, onSuccess);
  }

  create(createOptions, onSuccess) {
    this._browser.tabs.create(createOptions, onSuccess);
  }

  getActive(onSuccess) {
    this._browser.tabs.query({active: true}, onSuccess);
  }

  runScript(tab_id, script, payload, onSuccess, onError) {
    this._browser.tabs.executeScript(
      tab_id, {code: script},
      (result) => {
        // https://stackoverflow.com/a/45603880/258421
        let lastError = chrome.runtime.lastError;
        if (lastError) {
          onError(lastError, payload);
        } else {
          onSuccess(result, payload);
        }
      }
    );
  }

  getBrowserName() {
      return "chrome/chromium";
  }
}


console.log("Detecting browser");
var port = undefined;
var tabs = undefined;
var browserTabs = undefined;
const NATIVE_APP_NAME = 'brotab_mediator';

if (typeof browser !== 'undefined') {
  port = browser.runtime.connectNative(NATIVE_APP_NAME);
  console.log("It's Firefox: " + port);
  browserTabs = new FirefoxTabs(browser);

} else if (typeof chrome !== 'undefined') {
  port = chrome.runtime.connectNative(NATIVE_APP_NAME);
  console.log("It's Chrome/Chromium: " + port);
  browserTabs = new ChromeTabs(chrome);

} else {
  console.log("Unknown browser detected");
}


// see https://stackoverflow.com/a/15479354/258421
// function naturalCompare(a, b) {
//     var ax = [], bx = [];

//     a.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { ax.push([$1 || Infinity, $2 || ""]) });
//     b.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { bx.push([$1 || Infinity, $2 || ""]) });

//     while(ax.length && bx.length) {
//         var an = ax.shift();
//         var bn = bx.shift();
//         var nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
//         if(nn) return nn;
//     }

//     return ax.length - bx.length;
// }

function compareWindowIdTabId(tabA, tabB) {
  if (tabA.windowId != tabB.windowId) {
    return tabA.windowId - tabB.windowId;
  }
  return tabA.index - tabB.index;
}

function listTabsOnSuccess(tabs) {
  var lines = [];
  // Make sure tabs are sorted by their index within a window
  tabs.sort(compareWindowIdTabId);
  for (let tab of tabs) {
    var line = + tab.windowId + "." + tab.id + "\t" + tab.title + "\t" + tab.url;
    console.log(line);
    lines.push(line);
  }
  // lines = lines.sort(naturalCompare);
  port.postMessage(lines);
}

function listTabs() {
  browserTabs.list({}, listTabsOnSuccess);
}

// function moveTabs(move_triplets) {
//   for (let triplet of move_triplets) {
//     const [tabId, windowId, index] = triplet;
//     browserTabs.move(tabId, {index: index, windowId: windowId});
//   }
// }

function moveTabs(move_triplets) {
  // move_triplets is a tuple of (tab_id, window_id, new_index)
  if (move_triplets.length == 0) {
    // this post is only required to make bt move command synchronous. mediator
    // is waiting for any reply
    port.postMessage('OK');
    return
  }

  // we request a move of a single tab and when it happens, we call ourselves
  // again with the remaining tabs (first omitted)
  const [tabId, windowId, index] = move_triplets[0];
  browserTabs.move(tabId, {index: index, windowId: windowId},
    (tab) => moveTabs(move_triplets.slice(1))
  );
}

function closeTabs(tab_ids) {
  browserTabs.close(tab_ids, () => port.postMessage('OK'));
}

function openUrls(urls, window_id) {
  if (urls.length == 0) {
    console.log('Opening urls done');
    port.postMessage('OK');
    return;
  }

  const url = urls[0];
  console.log(`Opening another one url ${url}`);
  browserTabs.create({'url': url, windowId: window_id},
    (tab) => openUrls(urls.slice(1), window_id)
  );
}

function createTab(url) {
  browserTabs.create({'url': url},
    (tab) => {
      console.log(`Created new tab: ${tab.id}`);
      port.postMessage('OK');
  });
}

function activateTab(tab_id) {
  browserTabs.activate(tab_id);
}

function getActiveTabs() {
  browserTabs.getActive(tabs => {
      var result = tabs.map(tab => tab.windowId + "." + tab.id).toString()
      console.log(`Active tabs: ${result}`);
      port.postMessage(result);
  });
}

function getWordsFromTabs(tabs) {
  var promises = [];
  console.log(`Getting words from tabs: ${tabs}`);

  for (let tab of tabs) {
    var promise = new Promise(
      (resolve, reject) => browserTabs.runScript(tab.id, GET_WORDS_SCRIPT, null,
        (words, _payload) => {
          console.log(`Got ${words.length} words from another tab`);
          resolve(words);
        },
        (error, _payload) => {
          console.log(`Could not get words from tab: ${error}`);
          resolve([]);
        }
      )
    );
    promises.push(promise);
  }
  Promise.all(promises).then(
    (all_words) => {
      const result = Array.prototype.concat(...all_words);
      console.log(`Total number of words: ${result.length}`);
      port.postMessage(result);
    }
  )
}

function getWords(tab_id) {
  if (tab_id == null) {
    console.log(`Getting words for active tabs`);
    browserTabs.getActive(getWordsFromTabs);
  } else {
    console.log(`Getting words, running a script`);
    browserTabs.runScript(tab_id, GET_WORDS_SCRIPT, null,
      (words, _payload) => port.postMessage(words));
  }
}

function getTextFromTabs(tabs, onSuccess) {
  var promises = [];
  console.log(`Getting text from tabs: ${tabs.length}`);

  lines = [];
  for (let tab of tabs) {
    // console.log(`Processing tab ${tab.id}`);
    var promise = new Promise(
      (resolve, reject) => browserTabs.runScript(tab.id, GET_TEXT_SCRIPT, tab,
        (text, current_tab) => {
          // let as_text = JSON.stringify(text);
          // I don't know why, but an array of one item is sent here, so I take
          // the first item.
          text = text[0];
          console.log(`Got ${text.length} chars of text from another tab: ${current_tab.id}`);
          resolve({tab: current_tab, text: text});
        },
        (error, current_tab) => {
          console.log(`Could not get text from tab: ${error}: ${current_tab.id}`);
          resolve({tab: current_tab, text: ''});
        }
      )
    );
    promises.push(promise);
  }

  // console.log(`Awaiting text promises`);
  Promise.all(promises).then(onSuccess);
  // console.log(`getTextFromTabs done`);
}

function getTextOnRunScriptSuccess(all_results) {
  console.log(`Ready`);
  console.log(`Text promises are ready: ${all_results.length}`);
  // console.log(`All results: ${JSON.stringify(all_results)}`);
  lines = [];
  for (let result of all_results) {
    // console.log(`result: ${result}`);
    tab = result['tab'];
    text = result['text'];
    // console.log(`Result: ${tab.id}, ${text.length}`);
    let line = tab.windowId + "." + tab.id + "\t" + tab.title + "\t" + tab.url + "\t" + text;
    lines.push(line);
  }
  // lines = lines.sort(naturalCompare);
  console.log(`Total number of lines of text: ${lines.length}`);
  port.postMessage(lines);
}

function getTextOnListSuccess(tabs) {
  lines = [];
  // Make sure tabs are sorted by their index within a window
  tabs.sort(compareWindowIdTabId);
  getTextFromTabs(tabs, getTextOnRunScriptSuccess);
}

function getText() {
  browserTabs.list({'discarded': false}, getTextOnListSuccess);
}

function getBrowserName() {
  port.postMessage(browserTabs.getBrowserName());
}

/*
Listen for messages from the app.
*/
port.onMessage.addListener((command) => {
  console.log("Received: " + JSON.stringify(command, null, 4));

  if (command['name'] == 'list_tabs') {
    console.log('Listing tabs...');
    listTabs();
  }

  else if (command['name'] == 'close_tabs') {
    console.log('Closing tabs:', command['tab_ids']);
    closeTabs(command['tab_ids']);
  }

  else if (command['name'] == 'move_tabs') {
    console.log('Moving tabs:', command['move_triplets']);
    moveTabs(command['move_triplets']);
  }

  else if (command['name'] == 'open_urls') {
    console.log('Opening URLs:', command['urls'], command['window_id']);
    openUrls(command['urls'], command['window_id']);
  }

  else if (command['name'] == 'new_tab') {
    console.log('Creating tab:', command['url']);
    createTab(command['url']);
  }

  else if (command['name'] == 'activate_tab') {
    console.log('Activating tab:', command['tab_id']);
    activateTab(command['tab_id']);
  }

  else if (command['name'] == 'get_active_tabs') {
    console.log('Getting active tabs');
    getActiveTabs();
  }

  else if (command['name'] == 'get_words') {
    console.log('Getting words from tab:', command['tab_id']);
    getWords(command['tab_id']);
  }

  else if (command['name'] == 'get_text') {
    console.log('Getting texts from all tabs');
    getText();
  }

  else if (command['name'] == 'get_browser') {
    console.log('Getting browser name');
    getBrowserName();
  }
});

port.onDisconnect.addListener(function() {
  console.log("Disconnected");
});

console.log("Connected to native app");

/*
On a click on the browser action, send the app a message.
*/
// browser.browserAction.onClicked.addListener(() => {
//   // console.log("Sending:  ping");
//   // port.postMessage("ping");
//
//   console.log('Listing tabs');
//   listTabs();
// });
