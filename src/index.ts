/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2015, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
'use-strict';

import {
  DockPanel, DockMode
} from '../node_modules/phosphor-dockpanel';

import {
  KeymapManager
} from 'phosphor-keymap';

import {
  Menu, MenuBar, MenuItem
} from 'phosphor-menus';

import {
  Message
} from 'phosphor-messaging';

import {
  SplitPanel
} from 'phosphor-splitpanel';

import {
  Tab, TabPanel
} from 'phosphor-tabs';

import {
  ResizeMessage, Widget, attachWidget
} from 'phosphor-widget';

import {
  Terminal, ITerminalConfig
} from 'term.js';

import { 
  startNewKernel, Contents
} from '../jupyter-js-services/index';

import {
  ActionHandler
} from './actions';

import {
  CodeCell
} from './codecell';

import {
  KeyboardManager
} from './keyboardmanager';

import {
  Tooltip
} from './tooltip';

import './style.min.css';
import './ipython.min.css';
import './index.css';


/**
 * A widget which manages a terminal session.
 */
export
class TerminalWidget extends Widget {

  static nterms = 0;

  static createTerminal(config?: ITerminalConfig) : TerminalWidget{
    TerminalWidget.nterms += 1;
    var wsUrl = `ws://${ADDRESS}/terminals/websocket/${TerminalWidget.nterms}`;
    var term = new TerminalWidget(wsUrl, config);
    return term;
  }

  /*
   * Construct a new terminal.
   */
  constructor(ws_url: string, config?: ITerminalConfig) {
    super();
    this.addClass('TerminalWidget');
    this._ws = new WebSocket(ws_url);
    this._config = config || { useStyle: true };

    this._term = new Terminal(this._config);
    this._term.open(this.node);

    this._term.on('data', (data: string) => {
      this._ws.send(JSON.stringify(['stdin', data]));
    });

    this._ws.onmessage = (event: MessageEvent) => {
      var json_msg = JSON.parse(event.data);
      switch (json_msg[0]) {
        case "stdout":
          this._term.write(json_msg[1]);
          break;
        case "disconnect":
          this._term.write("\r\n\r\n[Finished... Term Session]\r\n");
          break;
        }
      };

    // create a dummy terminal to get row/column size
    this._dummy_term = document.createElement('div');
    this._dummy_term.style.visibility = "hidden";
    var pre = document.createElement('pre');
    var span = document.createElement('span');
    pre.appendChild(span);
    // 24 rows
    pre.innerHTML = "<br><br><br><br><br><br><br><br><br><br><br><br>" +
    "<br><br><br><br><br><br><br><br><br><br><br><br>"
    // 1 row + 80 columns
    span.innerHTML = "012345678901234567890123456789" +
    "012345678901234567890123456789" +
    "01234567890123456789";
    this._dummy_term.appendChild(pre);
    this._term.element.appendChild(this._dummy_term);
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    this._term.destroy();
    this._ws = null;
    this._term = null;
    super.dispose();
  }

  get config(): ITerminalConfig {
    return this._config;
  }

  /**
   * Set the configuration of the terminal.
   */
  set config(options: ITerminalConfig) {
    if (options.useStyle) {
      this._term.insertStyle(
        this._term.document, this._term.colors[256], this._term.colors[257]);
    }
    else if (options.useStyle === false) {
      var sheetToBeRemoved = document.getElementById('term-style');
      if (sheetToBeRemoved) {
        var sheetParent = sheetToBeRemoved.parentNode;
        sheetParent.removeChild(sheetToBeRemoved);

      }
    }

    if (options.useStyle !== null) {
      // invalidate terminal pixel size
      this._term_row_height = 0;
    }

    for (var key in options) {
      this._term.options[key] = (<any>options)[key];
    }

    this._config = options;
  }

  protected resize_term(width: number, height: number): void {
    if (!this._term_row_height) {
      this._term_row_height = this._dummy_term.offsetHeight / 25;
      this._term_col_width = this._dummy_term.offsetWidth / 80;
      this._dummy_term.style.display = 'none';
    }

    var rows = Math.max(2, Math.floor(height / this._term_row_height) - 2);
    var cols = Math.max(3, Math.floor(width / this._term_col_width) - 2);

    rows = this._config.rows || rows;
    cols = this._config.cols || cols;

    this._term.resize(cols, rows);
  }

  protected onResize(msg: ResizeMessage): void {
    this.resize_term(msg.width, msg.height);
  }

  private _ws: WebSocket;
  private _term: any;
  private _dummy_term: HTMLElement;
  private _term_row_height: number;
  private _term_col_width: number;
  private _config: ITerminalConfig;
}


/**
 * A widget which hosts a CodeMirror editor.
 */
class CodeMirrorWidget extends Widget {

  constructor(config?: CodeMirror.EditorConfiguration) {
    super();
    this.addClass('CodeMirrorWidget');
    this._editor = CodeMirror(this.node, config);
  }

  get editor(): CodeMirror.Editor {
    return this._editor;
  }

  set fontSize(size: string) {
    this._editor.getWrapperElement().style["font-size"] = size;
    this._editor.refresh();
  }

  loadFile(name: string, contents: string): void {
    var doc = this._editor.getDoc();
    if (name.indexOf('.py') !== -1) {
      this._editor.setOption('mode', 'python');
    } else if (name.indexOf('.ts') !== -1) {
      this._editor.setOption('mode', 'text/typescript');
    } else if (name.indexOf('.js') !== -1) {
      this._editor.setOption('mode', 'text/javascript');
    } else if (name.indexOf('.css') !== -1) {
      this._editor.setOption('mode', 'text/css');
    } else {
      this._editor.setOption('mode', 'text');
    }
    doc.setValue(contents);
  }

  protected onAfterAttach(msg: Message): void {
    this._editor.refresh();
  }

  protected onResize(msg: ResizeMessage): void {
    if (msg.width < 0 || msg.height < 0) {
      this._editor.refresh();
    } else {
      this._editor.setSize(msg.width, msg.height);
    }
  }

  private _editor: CodeMirror.Editor;
}


/**
 * A widget which hosts a File browser.
 */
class FileBrowser extends Widget {

  static createNode(): HTMLElement {
    var node = document.createElement('div');
    var inner = document.createElement('div');
    inner.className = 'list_container';
    node.appendChild(inner);
    return node;
  }

  constructor(baseUrl, currentDir) {
    super();
    this.addClass('content');
    this._contents = new Contents(baseUrl);
    document.addEventListener('mousedown', this, true);
    this._currentDir = currentDir;
  }

  get onClick(): (name: string, contents: string) => void {
    return this._onClick;
  }

  set onClick(cb: (name: string, contents: string) => void) {
    this._onClick = cb;
  }

  handleEvent(event: Event): void {
    if (!this.node.contains((<any>event).target)) {
      return;
    }
    if (event.type === 'mousedown') {
      var el = event.target as HTMLElement;
      var text = el.textContent;
      console.log('text', text);
      if (text[text.length - 1] == '/') {
        this._currentDir += text;
        this.listDir();
      } else if (text == '..') {
         var parts = this._currentDir.split('/');
         var parts = parts.slice(0, parts.length - 2);
         if (parts.length === 0) {
           this._currentDir = '';
         } else {
           this._currentDir = parts.join('/') + '/';
         }
         this.listDir();
      } else {
        var path = this._currentDir + (<HTMLElement>event.target).textContent;
        this._contents.get(path, { type: "file" }).then(msg => {
          var onClick = this._onClick;
          if (onClick) onClick(msg.path, msg.content);
        });
      }
    }
  }

  listDir() {
    while (this.node.firstChild.hasChildNodes()) {
       this.node.firstChild.removeChild(this.node.firstChild.lastChild);
    }
    if (this._currentDir.lastIndexOf('/') !== -1) {
      this._addItem('..', true);
    }
    var path = this._currentDir.slice(0, this._currentDir.length - 1);
    this._contents.listContents(path).then((msg) => {
      for (var i = 0; i < msg.content.length; i++ ) {
        if ((<any>msg).content[i].type === 'directory') {
          this._addItem((<any>msg).content[i].name + '/', true);
        } else {
          this._addItem((<any>msg).content[i].name, false);
        }
      }
    });
  }

  private _addItem(text: string, isDirectory: boolean) {
    var top = document.createElement('div');
    top.className = 'list_item'
    top.classList.add('row');
    var node = document.createElement('div');
    node.classList.add('col-md-12');
    var inode = document.createElement('i');
    inode.className = 'item_icon';
    inode.style.display = 'inline-block'
    inode.classList.add('icon-fixed-width');
    var lnode = document.createElement('div');
    lnode.className = 'item_link';
    lnode.classList.add('fileItem');
    lnode.textContent = text;
    if (isDirectory) {
      inode.classList.add('folder_icon');
    } else {
      inode.classList.add('file_icon');
    }
    node.appendChild(inode);
    node.appendChild(lnode);
    top.appendChild(node);
    this.node.firstChild.appendChild(top);

  }

  private _currentDir = '';
  private _onClick: (name: string, contents: string) => void = null;
  private _contents: Contents = null;
}


/**
 * A widget which hosts a Notebook.
 */
class Notebook extends Widget {

  static createNode(): HTMLElement {
    var node = document.createElement('div');
    var container = document.createElement('div');
    container.className = 'container';
    container.setAttribute('id', 'notebook-container');
    node.appendChild(container);
    var tooltip = document.createElement('div');
    tooltip.className = 'ipython_tooltip';
    tooltip.style.display = 'none';
    node.appendChild(tooltip);
    return node;
  }

  constructor() {
    super();
    this.addClass('content');
  }

  start(kernelOptions) {
    startNewKernel(kernelOptions).then(kernel => {
      this._kernel = kernel;
      console.log('Kernel started');
      var Events = function () {};
      this._events = $([new Events()]);
      var env = { notebook: this };

      this._actions = new ActionHandler({ env: env });

      this._manager = new KeyboardManager({
          notebook: this,
          events: this._events, 
          actions: this._actions });
      this._manager.mode = 'edit';

      this._tooltip = new Tooltip(this._events, this.node.lastChild);
      this._createCell();
    });
  }

  execute_cell_and_select_below() {
    this._cells[this._cells.length - 1].execute();
    this._cells[this._cells.length - 1].unselect();
    this._createCell();
  }

  private _createCell() {

    var options = {
      keyboard_manager: this._manager,
      notebook: this,
      events: this._events,
      tooltip: this._tooltip
    }
    var cell = new CodeCell(this._kernel, options);
    this.node.children[0].appendChild(cell.element[0]);

    cell.set_input_prompt();
    cell.select();
    cell.focus_editor();
    cell.selection_anchor = true;
    cell.render();
    cell.refresh();
    cell.mode = 'edit';

    this._events.trigger('create.Cell', 
                         { 'cell': cell, 'index': this._cells.length });
    this._cells.push(cell);
  }

  private _events: any = null;
  private _actions: any = null;
  private _manager: any = null;
  private _tooltip: any = null;
  private _kernel: any = null;
  private _cells: any[] = [];
}


var ADDRESS = 'localhost:8888';


function newNotebook(): Notebook {
  var kernelOptions = {
    baseUrl: `http://${ADDRESS}`,
    wsUrl: `ws://${ADDRESS}`,
    name: 'python'
  }
  var notebook = new Notebook();
  notebook.start(kernelOptions);
  return notebook;
}


function newEditor(listing?: FileBrowser): CodeMirrorWidget {
  var cm = new CodeMirrorWidget({
    mode: 'python',
    lineNumbers: true,
    tabSize: 2,
  });
  cm.loadFile('test.py', 'import numpy as np\nx = np.ones(3)'); 
  cm.fontSize = '10pt';
  if (listing !== void 0) {
    listing.onClick = (path, contents) => cm.loadFile(path, contents);
  }
  return cm;
}


function newFileBrowser(dirname?: string): FileBrowser {
  var listing = new FileBrowser(`http://${ADDRESS}`, dirname || '');
  listing.listDir();
  return listing;
}


class MainPanel extends DockPanel {

  constructor(listing: FileBrowser) { 
    super(); 
    this._listing = listing;
  }

  newNotebook(mode?: DockMode, ref?: Widget): boolean {
    var notebook = newNotebook();
    var tab = new Tab('Notebook');
    tab.closable = true;
    DockPanel.setTab(notebook, tab);
    this.addWidget(notebook, mode, ref);
    return true;
  }

  newEditor(mode?: DockMode, ref?: Widget): boolean {
    var editor = newEditor(this._listing);
    var tab = new Tab('Code Editor');
    tab.closable = true;
    DockPanel.setTab(editor, tab);
    this.addWidget(editor, mode, ref);
    return true;
  }

  newTerminal(mode?: DockMode, ref?: Widget): boolean {
    var term = TerminalWidget.createTerminal();
    var tab = new Tab(`Terminal ${TerminalWidget.nterms}`);
    tab.closable = true;
    DockPanel.setTab(term, tab);
    this.addWidget(term, mode, ref);
    return true;
  }

  newFileBrowser(mode?: DockMode, ref?: Widget): boolean {
    var listing = newFileBrowser();
    var tab = new Tab('File Browser');
    tab.closable = true;
    DockPanel.setTab(listing, tab);
    this.addWidget(listing, mode, ref);
    return true;
  }

  private _listing: FileBrowser = null;
}


function createMenuBar(panel: MainPanel): MenuBar {
  return MenuBar.fromTemplate([
    {
      text: 'File',
      submenu: [
        {
          text: 'New',
          submenu: [
            {
              text: 'Notebook',
              shortcut: 'Ctrl+N',
              handler: panel.newNotebook.bind(panel)
            },
            {
              text: 'Code Editor',
              shortcut: 'Ctrl+E',
              handler: panel.newEditor.bind(panel)
            },
            {
              text: 'Terminal',
              shortcut: 'Ctrl+T',
              handler: panel.newTerminal.bind(panel)
            },
            {
              text: 'File Browser',
              shortcut: 'Ctrl+F',
              handler: panel.newFileBrowser.bind(panel)
            }
          ]
        },
        {
          text: 'Open...',
        },
        {
          type: 'separator'
        },
        {
          text: 'Make a Copy...'
        },
        {
          text: 'Rename...'
        },
        {
          text: 'Save and Checkpoint'
        },
        {
          type: 'separator'
        },
        {
          text: 'Revert to Checkpoint',
          submenu: [
            {
              text: 'Monday September 28th 09:44'
            }
          ]
        },
        {
          type: 'separator'
        },
        {
          text: 'Print Preview'
        },
        {
          text: 'Download as',
          submenu: [
            {
              text: 'IPython Notebook (.ipynb)'
            },
            {
              text: 'Python (.py)'
            },
            {
              text: 'HTML (.html)'
            },
            {
              text: 'Markdown (.md)'
            },
            {
              text: 'reST (.rst)'
            },
            {
              text: 'PDF via LaTeX (.pdf)'
            }
          ]
        },
        {
          type: 'separator'
        },
        {
          text: 'Trusted Notebook'
        },
        {
          type: 'separator'
        },
        {
          text: 'Close and Halt'
        }
      ]
    },
    {
      text: 'Edit',
      submenu: [
        {
          text: 'Cut Cell'
        },
        {
          text: 'Copy Cell'
        },
        {
          text: 'Paste Cell Above'
        },
        {
          text: 'Paste Cell Below'
        },
        {
          text: 'Paste Cell and Replace'
        },
        {
          text: 'Delete Cell'
        },
        {
          text: 'Undo Delete Cell'
        },
        {
          type: 'separator'
        },
        {
          text: 'Split Cell'
        },
        {
          text: 'Merge Cell Above'
        },
        {
          text: 'Merge Cell Below'
        },
        {
          type: 'separator'
        },
        {
          text: 'Move Cell Up'
        },
        {
          text: 'Move Cell Down'
        },
        {
          type: 'separator'
        },
        {
          text: 'Edit Notebook Metadata'
        }
      ]
    },
    {
      text: 'View',
      submenu: [
        {
          text: 'Toggle Header'
        },
        {
          text: 'Toggle Toolbar'
        }
      ]
    },
    {
      text: 'Insert',
      submenu: [
        {
          text: 'Insert Cell Above'
        },
        {
          text: 'Insert Cell Below'
        }
      ]
    },
    {
      text: 'Cell',
      submenu: [
        {
          text: 'Run'
        },
        {
          text: 'Run and Select Below'
        },
        {
          text: 'Run and Insert Below'
        },
        {
          text: 'Run All'
        },
        {
          text: 'Run All Above'
        },
        {
          text: 'Run All Below'
        },
        {
          type: 'separator'
        },
        {
          text: 'Cell Type',
          submenu: [
            {
              text: 'Code'
            },
            {
              text: 'Markdown'
            },
            {
              text: 'Raw NB Convert'
            }
          ]
        },
      ]
    },
    {
      text: 'Kernel',
      submenu: [
        {
          text: 'Interrupt'
        },
        {
          text: 'Restart'
        },
        {
          text: 'Reconnect'
        },
        {
          type: 'separator'
        },
        {
          text: 'Change kernel',
          submenu: [
            {
              text: 'Python 3'
            }
          ]
        }
      ]
    },
    {
      text: 'Help',
      submenu: [
        {
          text: 'User Interface Tour'
        },
        {
          text: 'Keyboard Shortcuts'
        },
        {
          type: 'separator'
        },
        {
          text: 'Python'
        },
        {
          text: 'IPython'
        },
        {
          text: 'NumPy'
        },
        {
          text: 'SciPy'
        },
        {
          text: 'Matplotlib'
        },
        {
          text: 'SymPy'
        },
        {
          text: 'pandas'
        },
        {
          type: 'separator'
        },
        {
          text: 'About'
        }
      ]
    }
  ]);
}


function main(): void {
  
  var listing = newFileBrowser();
  var dock = new MainPanel(listing);
  var keymap = new KeymapManager();
  keymap.add('*', [
    { sequence: 'Ctrl+N', handler: dock.newNotebook.bind(dock) },
    { sequence: 'Ctrl+E', handler: dock.newEditor.bind(dock) },
    { sequence: 'Ctrl+T', handler: dock.newTerminal.bind(dock) },
    { sequence: 'Ctrl+F', handler: dock.newTerminal.bind(dock) },
  ]);

  document.addEventListener('keydown', event => {
    keymap.processKeydownEvent(event);
  });

  var running = new Widget();
  var runTab = new Tab('Running');
  runTab.closable = true;

  TabPanel.setTab(listing, new Tab('Files'));
  TabPanel.setTab(running, runTab);

  var leftPanel = new TabPanel();
  leftPanel.id = 'left';

  leftPanel.widgets = [listing, running];

  var panel = new SplitPanel();
  panel.id = 'main';

  panel.children = [leftPanel, dock];
  panel.setSizes([1, 3]);

  dock.newEditor();
  dock.newTerminal(DockMode.SplitBottom, dock.children[0]);
  dock.newNotebook(DockMode.SplitLeft, dock.children[1]);

  var menuBar = createMenuBar(dock);
  attachWidget(menuBar, document.body);

  attachWidget(panel, document.body);
  panel.update();
  window.onresize = () => panel.update();
}

window.onload = main;

