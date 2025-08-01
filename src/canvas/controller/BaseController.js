import hash from '../../dojo/hash'
import lang from '../../dojo/_base/lang'

import Core from '../../core/Core'
import CoreUtil from '../../core/CoreUtil'
import Logger from '../../common/Logger'
import PerformanceMonitor from '../../core/PerformanceMonitor'
import * as CollabUtil from './CollabUtil'
import CollabService from './CollabService'
import ModelFixer from './ModelFixer'
export default class BaseController extends Core {

  constructor (params){
		super()
		this.logger = new Logger("BaseController");
		this.mode = 'private'

		if(params && params.mode){
			this.mode = params.mode;
		}
		this.stackMaxLength = 300
		this.stackElementToRemove = 150
		this.debug = false
		this.active = true
		this.transactions = {}
		this._modelRenderJobs = {}
		this._modelChanges = []
		this.collabService = new CollabService()
		this.logger.log(1,"constructor", "entry > " + this.mode);
		this.commandStack =  {stack : [], pos : 0, id:0};
		this._lastChangedWidgets = {};
	}

	/**********************************************************************
	 * Dependencies
	 **********************************************************************/

	setPublic (isPublic) {
		if (isPublic) {
			this.mode = 'public'
		}
	}

	setModelService (s) {
		this.modelService = s
	}

	setCanvas (c){
		this.logger.log(3,"setCanvas", "entry");
		this._canvas = c;
	}

	setToolbar (t){
		this.logger.log(3,"setToolbar", "entry");
		this.toolbar = t;
	}

	setModelFactory (f){
		this.logger.log(3,"setModelFactory", "entry");
		/**
		 * Just used for templated widgets...
		 */
		this.factory = f;
	}

	/**
	 * Method is called on first load. Inits the
	 */
	setModel (m, screenID){
		this.logger.log(1,"setModel", "entry > " + screenID);

		this.model = m;
		this.oldModel = lang.clone(m);
		this.collabService.setModel(m)

		/**
		 * Apply model fixes here that might happen
		 * due to this crappy software
		 */
		//ModelFixer.fixCorruptedModel(this.model)
		ModelFixer.fixNegativeCoords(m);
		ModelFixer.fixZValues(m);
		ModelFixer.fixModelCount(m);
		ModelFixer.fixRecursiveGroups(this.model)
		ModelFixer.fixMissingSubgroups(this.model)
		ModelFixer.fixDoubleGroup(this.model)

		this.initCanvas(screenID);

		if(this.toolbar){
			this.toolbar.setModel(m);
		} else {
			this.logger.log(2,"setModel", "No toolbar");
		}

		if (this._canvas) {
			this._canvas.setFonts(m.fonts)
			this._canvas.setModel(this.model)
		}

		this.initChangeStack(m.id)
		/**
		 * Load model from local db and check if we have
		 * a newer version
		 */
		//this.modelDB.get(m.id).then(localModel => {
			//this.checkModel(localModel)
		//})
	}

	checkModel (localModel) {
		this.logger.log(2,"checkModel", "enter");
		if (localModel && this.model) {
			this.logger.log(-1,"checkModel", "enter :"  + localModel.lastUpdate  + ' > ' + this.model.lastUpdate);
			if (localModel.lastUpdate > this.model.lastUpdate) {
				this.logger.error("checkModel", "error > Local mode not the newer: " + localModel.lastUpdate  + ' > ' + this.model.lastUpdate);
				this.logger.sendError(new Error('Local Model is newer'))

				/**
				 * This is tricky. Thing of the following scenarios:
				 *
				 * 1) User A is offline and the local model is last edited at t1 (e.g. 12h). The server
				 * model is still at t0 (e.g. 11h). In thsi case we should patch the model.
				 *
				 * 2) What happens if we have concurrent editing? User B edits at 13h, and misses A's changes. We would not warn,
				 * because the server version is newer. A's changesa are lost.
				 *
				 * 3) Now let's assume B changes the last time at 11:30h. In this case A's changes are newer and
				 * woudl win.
				 *
				 */
				/*
				if (this.toolbar) {
					this.toolbar.showOutOFSyncError(localModel, result => {
						console.debug(result)
					})
				}
				*/
			}
		}
	}

	setMode (mode, forceRender){
		this.logger.log(2,"setMode", "entry > " + mode);
		this._canvas.setMode(mode, forceRender);
	}

	setSinglePage (enabled){
		this.logger.log(0,"setSinglePage", "entry > " + enabled);
	}


	getZoomFactor (){
		if(this._canvas){
			return this._canvas.getZoomFactor();
		}
		return 1;
	}

	onExit (){
		this.logger.log(-1,"onExit", "enter > " );
		this.active = false;
	}

	/**********************************************************************
	 * Model name
	 **********************************************************************/
	setModelName (name) {
		this.model.name = name
		this.setDirty()
	}

	/**********************************************************************
	 * Selection methods
	 **********************************************************************/

	onRulerSelected (screenID, rulerID) {
		this.logger.log(0 ,"onRulerSelected", "enter > ");
		if(this.toolbar){
			var screen = this.model.screens[screenID];
			if (screen) {
				let ruler = screen.rulers.find(r => r.id === rulerID)
				if (ruler) {
					this.toolbar.onRulerSelected(screen, ruler);
				}
			}
		}
	}

	onWidgetSelected (id){
		this.logger.log(3,"onWidgetSelected", "enter > "+ id);
		const widget = this.model.widgets[id];
		if (!widget) {
			this.logger.error("onWidgetSelected", "exit > No widget with id: "+ id);
			return
		}
		if(this.toolbar){
			this.toolbar.onWidgetSelected(widget);
		}
	}

	onInheritedWidgetSelected (widget) {
		this.logger.log(3,"onInheritedWidgetSelected", "enter > "+ widget.id);

		if(this.toolbar){
			this.toolbar.onInheritedWidgetSelected(widget);
		}
	}


	onScreenSelected (id){
		this.logger.log(1,"onScreenSelected", "enter > "+ id);
		var screen = this.model.screens[id];
		if(this.toolbar){
			this.toolbar.onScreenSelected(screen);
		}
	}

	onCanvasSelected (){
		this.logger.log(1,"onCanvasSelected", "enter ");
		if(this.toolbar){
			this.toolbar.onCanvasSelected();
		}
	}

	onLineSelected (id){
		this.logger.log(1,"onLineSelected", "enter > " + id);
		var line = this.model.lines[id];
		if(this.toolbar){
			this.toolbar.onLineSelected(line);
		}
	}

	onMultiSelect (selection){
		this.logger.log(1,"onMultiSelect", "enter > ");
		if(this.toolbar){
			/**
			 * TODO: get all the model elements
			 */
			this.toolbar.onMultiSelect(selection);
		}
	}

	onGroupSelected (id){
		this.logger.log(1,"onGroupSelected", "enter > " + id);
		if(this.model.groups && this.model.groups[id]){
			if(this.toolbar){
				var group = this.model.groups[id];
				this.toolbar.onGroupSelect(group);
			}
		}
	}

	/**********************************************************************
	 * LiveCycle Hooks
	 **********************************************************************/

	onElementCreated (element) {
		this.logger.log(1,"onElementCreated", "enter", element.id);
	}

	/**********************************************************************
	 * Model change methods
	 **********************************************************************/


	onModelChanged (changes){
		this.logger.log(1,"onModelChanged", "enter");
		if (!changes) {
			console.warn('onModelChanged()', 'No Changes')
		}
		if (this.active) {
			this._modelHasChanged = true
			this._modelChanges = this._modelChanges.concat(changes)
		} else {
			this.logger.log(1,"onModelChanged", "Exit because not active");
		}
	}

	startModelChange () {
		PerformanceMonitor.start("BaseController.startModelChange()")
		this._modelChanges = []
		this._modelRenderJobs = {}
		this._modelHasChanged = false
	}

	commitModelChange (updateChangeStack=true) {
		this.logger.log(-1,"commitModelChange", "enter  >  changes: " + this._modelHasChanged + " > " + updateChangeStack);

		//this.updateAutoGroups();
		// ungroup should not be possible for autoGroups

		const inheritedModel = this.getInheritedModel(this.model)

		// if we do not update the command stack, it was and undo redo,
		// so we have to compute tall the changes and send to server
		if (this._modelHasChanged || !updateChangeStack) {
			if (this.toolbar){
				this.toolbar.updatePropertiesView();
			}
			this.model.lastUpdate = new Date().getTime();
			this.model.screenCount = Object.keys(this.model.screens).length
			this.model.widgetCount = Object.keys(this.model.widgets).length


			if (this.oldModel && updateChangeStack) {
				// we need to fire the commandStack changes here,
				// because setDirty has some delay... 
				// - Maybe we can remove the delay in the future
				// - Maybe we can allreayd stores here, so we do not have to compute twice?
				const modelChanges = CollabUtil.getModelDelta(this.oldModel, this.model);					
				this.addChangeStack(modelChanges)
				
			} else {	
				this.logger.log(1,"commitModelChange", "Do not update changeStack");
			}

			this.setDirty();
			this.emit('change', this.model)

			if (this._canvas){
				this._canvas.updateSourceModel(inheritedModel);
			}
		}

		if (this._modelRenderJobs['complete'] === true) {
			requestAnimationFrame(() => {
				const isResize = this._modelRenderJobs['complete']
				this._canvas.render(inheritedModel, isResize);			
			})
		} else if (this._modelRenderJobs['position'] === true) {
			requestAnimationFrame(() => {
				this._canvas.onWidgetPositionChange(inheritedModel);	
			})			
		} else {
			requestAnimationFrame(() => {
				const isResize = this._modelRenderJobs['all']
				this._canvas.render(inheritedModel, isResize);			
			})
		}
				
		this._modelChanges = []
		this._modelRenderJobs = {}
		this._modelHasChanged = false

		PerformanceMonitor.end("BaseController.startModelChange()")
	}

	getInheritedModel (model) {
		//console.trace()
		PerformanceMonitor.start("BaseController.getInheritedModel()")
		const result =  CoreUtil.createInheritedModel(model)
		PerformanceMonitor.end("BaseController.getInheritedModel()", 2)
		return result
	}



	/***************************************************************************************
	 *  Model saving
	 ***************************************************************************************/

	setDirty (saveCommandStack=true){
		this.logger.log(-1,"setDirty", "enter > ", this._dirty);
		this._dirty = true;
		if (this.debug){
			this.saveModelChanges(saveCommandStack);
		} else {
			setTimeout(() => {
				this.saveModelChanges(saveCommandStack);
			}, 300);
		}
	}

	async saveModelChanges () {

		if (!this._dirty){
			return
		} 
	
		if (this.mode == "public" && !this.debug){
			this.showSuccess("Please register to save changes...");
			ModelFixer.validateAndFixModel(this.model);
			ModelFixer.fixRecursiveGroups(this.model)
			ModelFixer.fixMissingSubgroups(this.model)
			ModelFixer.fixDoubleGroup(this.model)
			this.emit("notSavedWarningShow", this.model);
			return
		} 

			
		if (this.oldModel) {

			/**
			 * Validate and fix model
			 */
			ModelFixer.validateAndFixModel(this.model);
			ModelFixer.fixRecursiveGroups(this.model)
			ModelFixer.fixMissingSubgroups(this.model)
			ModelFixer.fixDoubleGroup(this.model)
			
			// this might be different changes from the 
			// command stack changes
			const changes = CollabUtil.getModelDelta(this.oldModel, this.model);

			this.logger.log(4,"saveModelChanges", "Save changes " + changes.length);
			if (changes.length > 0) {
				/**
				 * We start a transaction, and we will close it.
				 */
				const transactionId = this.startTransaction(changes)
				/**
				 * This could have retries :D
				 */
				this.modelService.updateApp(this.model, changes).then(res => {
					this.endTransaction(transactionId)
					this.onModelUpdated(res);
				}).catch(err => {
					this.logger.error("saveModelChanges", "Something wenrt wrong with the rest", err);
					this.showError("Could not reach server! Changes not saved!");
				})

				/**
				 * Since 4.2 we broadcast changes
				 */
				this.collabBroadcastChanges(changes)

			} else {
				this.logger.error("saveModelChanges", "Triggered without getting change! We send entire model");
				let res = await this.modelService.saveApp(this.model)
				this.onModelSaved(res);
			}
			this._dirty = false;

			/**
			 * Clone currrent model as old model, so we can later again compute deltas
			 */
			this.setOldModel(this.model);
		} else {
			console.warn("saveModelChanges() > No oldModel!", this);
		}		
	}

	async onModelUpdated (response){
		/**
		 * Some server shit might happen. In this case we
		 * save the entire app.
		 */
		if(response && response.type === "error") {
			this.logger.error("onModelUpdated", "Error while partial save. ");
			let res = await this.modelService.saveApp(this.model)
			this.onModelSaved(res)
			this.logger.sendError("onModelUpdated", new Error("Could not update. Check Server Log"));
		} else {
			this.showSuccess("Model Updated!");
		}
	}

	onModelSaved (){
		this.logger.error("onModelSaved", "Should not have been called!");
		this.showSuccess("Model Saved!");
	}

	setOldModel (model) {
		this.oldModel = lang.clone(model);
	}

	/***************************************************************************************
	 *  Rendering
	 ***************************************************************************************/

	initCanvas (screenID){
		this.logger.log(2,"initCanvas", "enter > screenID : " + screenID);
		if(this._canvas){
			const inheritedModel = this.getInheritedModel(this.model)
			requestAnimationFrame(() => {
				this._canvas.render(inheritedModel);
				if(screenID){
					this._canvas.moveToScreen(screenID);
				}
			});
		}		
	}

	render (screenID, isResize = false){
		this.logger.log(2,"render", "enter > screenID : " + screenID);	
		this._modelRenderJobs['all'] = isResize		
	}

	completeRender () {
		this.logger.log(10, "completeRender", "enter");	
		this._modelRenderJobs['complete'] = true		
	}

	/**
	 * Notify the canvas that there has been some changes in widget positions!
	 */
	onWidgetPositionChange () {
		this.logger.log(2,"onWidgetPositionChange", "enter");		
		this._modelRenderJobs['position'] = true
	}

	onLayerListChange () {
		this.logger.log(2,"onLayerListChange", "enter");
		this._modelRenderJobs['position'] = true
	}


	renderWidget (widget, type){
		this.logger.log(1,"renderWidget", "enter > type : ", type);
		if (widget && this._canvas) {
			/**
				* In case we have a templated or design token widget, we
				* kick of a complete rendering. This is to make sure that we
				* merge in all the style. This does not hurt too much, because
				* we have the partical rendering now.
				* TODO: We could use the ModelUtil and inline the template and
				*  the design tokens
				*/
			if (widget.template || widget.designtokens){
				this._modelRenderJobs['all'] = false
			} else {
				this._canvas.setWidgetStyle(widget.id, widget.style, widget);
				if (type === 'props') {
					this._canvas.updateWidgetDataView(widget);
				}
			}
		}
	}

	renderScreen (screen){
		if(this._canvas){
			this._canvas.setScreenStyle(screen.id, screen.style);
		}
	}

	/***************************************************************************************
	 *  Collab stuff
	 ***************************************************************************************/

	setModelChangeListener (callback) {
		this.collabChangeListener = callback
	}

	collabBroadcastChanges (changes) {
		this.logger.log(1, "collabBroadcastChanges", "enter " , changes);

		if (this.collabService && this.collabChangeListener) {
			let event = this.collabService.createEvent(changes)
			this.collabChangeListener(event)
		}

	}

	collabRecieveChanges (user, event) {
		this.logger.log(-1, "collabRecieveChanges", "enter " , event);

		/**
		 * Called from CollabSession with other users event.
		 * 1) Apply changes and set the model as the old model to 
		 * avoid recursve calls or double saves
		 * 2) Render
		 * 
		 * we do not commit model changes, as we expect
		 * they other to have done this
		 */
		this.model = this.collabService.applyEvent(this.model, event)
		this.setOldModel(this.model)
		
		const inheritedModel = this.getInheritedModel(this.model)
		requestAnimationFrame(() => {
			this._canvas.render(inheritedModel, false);
			//this._canvas.renderAllCollabMousePositions()
		})
	
		this.logger.log(-1, "collabRecieveChanges", "exit " , this.model.lastUUID);
	}


	/***************************************************************************************
	 *  Local model Storage & transactions
	 ***************************************************************************************/


	storeModel () {
		this.logger.log(3, "storeModel", "enter " );
		//this.modelDB.save(model)
	}

	startTransaction (changes) {
		let id = new Date().getTime() + '_' + Math.round(Math.random() * 1000)
		this.transactions[id] = {
			id: id,
			ts: new Date().getTime(),
			changes: changes
		}
		/**
		 * FIXME: We should think here about a good strategy for dealing with errors.
		 * We could:
		 *  - Think about persisting the changes and fire them again?
		 *  - Check on reload if there are open changes and fire and apply them again?
		 *  - We should in this case also save the entire model.... check the last update???
		 */
		if (!this.debug) {
			this.logger.log(3, "startTransaction", "enter " + id);
			setTimeout(() => this.checkTransaction(id, 0), 3000)
		}
		return id
	}

	checkTransaction (id, number) {

		/**
		 * If we still have a transaction id in our list, this means the
		 * is potentially and issue. We
		 */
		if (this.transactions[id]) {
			this.logger.log(1, "checkTransaction", "enter #" + number, this.transactions[id].ts);
			if (number < 10) {
				/**
				 * For now we just log that that a transaction failed.
				 * We should consoder resending!
				 */
				setTimeout(() => this.checkTransaction(id, number + 1), 3000)
			} else {
				/**
				 * here something is really wrong!
				 */
				this.logger.error("checkTransaction", "Too many secs");
			}
		}
	}

	endTransaction (id) {
		this.logger.log(3, "endTransaction", "enter " + id);
		let transaction = this.transactions[id]
		if (transaction) {
			this.logger.log(2, "endTransaction", "time " + (new Date().getTime() - transaction.ts));
		}
		delete this.transactions[id]
	}


	/**********************************************************************
	 * Canvas Delegates
	 **********************************************************************/

	onWidgetNameChange (widget) {
		if (this._canvas) {
			this._canvas.setWidgetName(widget)
		}
	}

	onScreenNameChange (widget) {
		if (this._canvas) {
			this._canvas.setScreenName(widget)
		}
	}

	onGroupNameChange (group) {
		if (this._canvas) {
			this._canvas.setGroupName(group)
		}
	}

	unSelect (){
		if(this._canvas){
			this._canvas.unSelect();
		}
		if(this.toolbar){
			this.toolbar.cleanUp();
		}
	}

	/**********************************************************************
	 * Tools
	 **********************************************************************/


	updateCreateWidget (){
		this.toolbar.toolUpdateWidgetButton();
	}

	renderCopyPasteStyleEnd (){
		this.toolbar.toolCopyPasteStyleEnd();
	}

	renderAlignEnd (){
		this.toolbar.toolAlignEnd();
	}

	showSuccess (msg){
		if(this._canvas){
			this._canvas.showSuccess(msg);
		}
	}

	showError (msg){
		if(this._canvas){
			this._canvas.showError(msg);
		}
	}

	/**********************************************************************
	 * on save as
	 **********************************************************************/
	async onSaveAs (oldModel, newName){
		/**
		 * Create a new version
		 */
		const app = await this.modelService.copyApp(oldModel, newName)
		this.logger.log(0, "onSaveAs", "New app" + app.id);
		return app;
	}

	async onSaveAsAfterSignUp (oldModel, newName){
		/**
		 * Create a new version
		 */
		oldModel.name = newName;
		oldModel.parent = oldModel.id;
		delete oldModel.id;
		delete oldModel._id;
		var app = await this.modelService.createApp(oldModel)
		hash("#/apps/" + app.id + ".html");
		this.logger.log(0, "onSaveAsAfterSignUp", "New app" + app.id);
	}

	/**********************************************************************
	 * Fonts
	 **********************************************************************/
	async setFonts (fonts) {
		this.logger.log(0, "setFonts", "enter > ", fonts);
		this.model.fonts = fonts;
		/**
		 * We have to do a hard save here, because the delta somehow produces
		 * on the server null elements
		 */
		const res = await this.modelService.saveApp(this.model)
		if (res) {
			if (this._canvas){
				this._canvas.setFonts(fonts);
			}
			if (this.toolbar){
				this.toolbar.updateFontFamilies()
			}
		}
	}

	/**********************************************************************
	 * Imports
	 **********************************************************************/

	async setImports (imports) {
		this.logger.log(0, "setFonts", "enter > ", imports);
		this.model.imports = imports;
		/**
		 * We have to do a hard save here, because the delta somehow produces
		 * on the server null elements
		 */
		const res = await this.modelService.saveApp(this.model)
		if (res) {
			if (this.toolbar){
				this.toolbar.updateImports()
			}
		}
	}

	/**********************************************************************
	 * Grid
	 **********************************************************************/

	removeGrid (){
		this.startModelChange()
		const command = {
			timestamp : new Date().getTime(),
			type : "SetGrid",
			n : null,
			o : this.model.grid
		};
		this.addCommand(command);
		this.modelSetGrid(null);
		this.render();
		this.commitModelChange()
	}

	setGrid (width, height, color, style,visible, enabled){
		this.startModelChange()
		/**
		 * create the command
		 */
		 const grid = {
			w : width,
			h : height,
			color : color,
			style : style,
			visible:visible,
			enabled:enabled
		};
		const command = {
			timestamp : new Date().getTime(),
			type : "SetGrid",
			n : grid,
			o : this.model.grid
		};
		this.addCommand(command);
		this.modelSetGrid(grid);
		this.render();
		this.commitModelChange()
	}

	setGrid2 (grid, color, style){
		this.startModelChange()
		/**
		 * mixing color
		 */
		grid.color = color;
		grid.style = style;
		const command = {
			timestamp : new Date().getTime(),
			type : "SetGrid",
			n : grid,
			o : this.model.grid
		};
		this.addCommand(command);
		this.modelSetGrid(grid);
		this.render();
		this.commitModelChange()
	}

	modelSetGrid (grid){
		this.model.grid = grid;
		this.onModelChanged([{type: 'grid', action:"add"}]);
	}


	undoSetGrid (command){
		this.modelSetGrid(command.o);
		this.render();
	}

	redoSetGrid (command){
		this.modelSetGrid(command.n);
		this.render();
	}

	/**********************************************************************
	 * Add Action
	 **********************************************************************/

	addAction (widgetID, action, isGroup){
		this.startModelChange()
		const command = {
			timestamp : new Date().getTime(),
			type : "AddAction",
			model : action,
			modelID : widgetID,
			isGroup: isGroup
		};
		this.addCommand(command);
		this.modelAddAction(widgetID, action, isGroup);
		this.commitModelChange()
	}

	modelAddAction (widgetID, action, isGroup){
		if(isGroup){
			const group = this.model.groups[widgetID];
			if(group){
				group.action = action;
			} else {
				console.warn("modelRemoveAction() > No group with ID", widgetID)
			}
		} else {
			const widget = this.model.widgets[widgetID];
			if(widget){
				widget.action = action;
			} else {
				console.warn("modelRemoveAction() > No widgte with ID", widgetID)
			}
		}
		this.onModelChanged([{type: 'grid', action:"add"}]);
	}

	undoAddAction (command){
		const action = command.model;
		const id = command.modelID;
		this.modelRemoveAction(id, action, command.isGroup);
		this.render();
	}

	redoAddAction (command){
		const action = command.model;
		const id = command.modelID;
		this.modelAddAction(id, action, command.isGroup);
		this.render();
	}

	/**********************************************************************
	 * Remove Action
	 **********************************************************************/


	removeAction (widgetID, action, isGroup){
		this.startModelChange()
		const command = {
			timestamp : new Date().getTime(),
			type : "RemoveAction",
			model : action,
			modelID: widgetID,
			isGroup: isGroup
		};
		this.addCommand(command);
		this.modelRemoveAction(widgetID, action, isGroup);
		this.commitModelChange()
	}

	modelRemoveAction (widgetID, action, isGroup){
		if (isGroup) {
			const group = this.model.groups[widgetID];
			if(group){
				delete group.action;
			} else {
				console.warn("modelRemoveAction() > No group with ID", widgetID)
			}
		} else {
			const widget = this.model.widgets[widgetID];
			if(widget){
				delete widget.action;
			} else {
				console.warn("modelRemoveAction() > No widgte with ID", widgetID)
			}
		}
		this.onModelChanged([{type: 'grid', action:"remove"}]);
	}


	undoRemoveAction (command){
		const action = command.model;
		const id = command.modelID;
		this.modelAddAction(id, action, command.isGroup);
		this.render();
	}

	redoRemoveAction (command){
		const action = command.model;
		const id = command.modelID;
		this.modelRemoveAction(id, action, command.isGroup);
		this.render();
	}

	/**********************************************************************
	 * update Action
	 **********************************************************************/
	updateAction (widgetID, action, isGroup) {
		this.startModelChange()
		const command = {
			timestamp : new Date().getTime(),
			type : "ActionAction",
			modelID: widgetID,
			n: action,
			o: this.getActionById(widgetID, isGroup),
			isGroup: isGroup
		};
		this.addCommand(command);
		this.modelUpdateAction(widgetID, action, isGroup);
		this.commitModelChange()
	}

	getActionById (id, isGroup) {
		if (isGroup){
			const group = this.model.groups[id];
			return group.action;
		} else {
			const widget = this.model.widgets[id];
			return widget.action;
		}
	}

	modelUpdateAction (widgetID, action, isGroup) {
		if(isGroup){
			const group = this.model.groups[widgetID];
			if(group){
				group.action = action;
			} else {
				console.warn("modelUpdateAction() > No group with ID", widgetID)
			}
		} else {
			const widget = this.model.widgets[widgetID];
			if(widget){
				widget.action = action;
			} else {
				console.warn("modelUpdateAction() > No widgte with ID", widgetID)
			}
		}

		this.onModelChanged([{type: 'grid', action:"update"}]);
	}

	undoActionAction (command){
		const action = command.o;
		const id = command.modelID;
		this.modelUpdateAction(id, action, command.isGroup);
		this.render();
	}

	redoActionAction (command){
		const action = command.n;
		const id = command.modelID;
		this.modelUpdateAction(id, action, command.isGroup);
		this.render();
	}


	/**********************************************************************
	 * Add Line
	 **********************************************************************/

	addLine (line){
		this.startModelChange()
		/**
		 * here comes already the correct model.
		 * we do not have to do anything more,
		 * just add an uuid
		 */
		line.id = "l"+this.getUUID();
		const zoom = this._canvas.getZoomFactor();
		for(var i=0; i< line.points.length; i++){
			this.getUnZoomedBox(line.points[i], zoom);
		}

		/**
		 * create the command
		 */
		 const command = {
			timestamp : new Date().getTime(),
			type : "AddLine",
			model : line
		};
		this.addCommand(command);

		/**
		 * update model
		 */
		this.modelAddLine(line);
		this.render();
		this.commitModelChange()
	}

	modelAddLine (line){
		if (!this.model.lines[line.id]) {
			this.model.lines[line.id] = line;
			this.onModelChanged([{type: 'line', action:"add", id:line.id}]);
		} else {
			console.warn("Could not add line", line);
		}
	}


	modelRemoveLine (line){
		if (this.model.lines[line.id]) {
			delete this.model.lines[line.id];
			this.onModelChanged([{type: 'line', action:"remove", id:line.id}]);
		} else {
			console.warn("Could not delete line", line);
		}
	}

	undoAddLine (command){
		const line = command.model;
		this.modelRemoveLine(line);
		this.render();
	}

	redoAddLine (command){
		const line = command.model;
		this.modelAddLine(line);
		this.render();
	}


	/**********************************************************************
	 * Add Line
	 **********************************************************************/

	removeLine (line){
		this.startModelChange()
		const command = {
			timestamp : new Date().getTime(),
			type : "RemoveLine",
			model : line
		};
		this.addCommand(command);
		this.modelRemoveLine(line);
		this.render();
		this.commitModelChange()
	}

	undoRemoveLine (command){
		const line = command.model;
		this.modelAddLine(line);
		this.render();
	}

	redoRemoveLine (command){
		const line = command.model;
		this.modelRemoveLine(line);
		this.render();
	}

	/**********************************************************************
	 * Line Points
	 **********************************************************************/


	updateLinePoint (id, i, pos){
		this.logger.log(3,"updateLinePoint", "enter > line : " + id +  " > point : " + i);

		pos = this.getUnZoomedBox(pos, this._canvas.getZoomFactor());

		/**
		 * create the command
		 */
		const line = this.model.lines[id];
		if (line.points[i]) {
			this.startModelChange()
			const point = line.points[i];
			const command = {
				timestamp : new Date().getTime(),
				type : "LinePointPosition",
				delta :{
					o : point,
					n : pos
				},
				i : i,
				modelId : id
			};
			this.addCommand(command);
			this.modelLinePointPosition(id, i, pos);
			this.commitModelChange()
		}
	
	}

	modelLinePointPosition (id, i, pos){
		var line = this.model.lines[id];
		if(line.points[i]){
			line.points[i] = pos;
		} else {
			console.warn("Could not update line point ", i, "in line", id);
		}

		this.onModelChanged([{type: 'line', action:"change", id:id}]);
	}

	undoLinePointPosition (command){
		this.modelLinePointPosition(command.modelId, command.i, command.delta.o);
		this.render();
	}

	redoLinePointPosition (command){
		this.modelLinePointPosition(command.modelId, command.i, command.delta.n);
		this.render();
	}

	/**********************************************************************
	 * Line Properties
	 **********************************************************************/
	updateLineProperties (id, key, value){
		this.logger.log(0,"updateLineProperties", "enter >key : " + key +  " > value : " + value);

		const line = this.model.lines[id];
		if (line) {
			this.startModelChange()
			var command = {
				timestamp : new Date().getTime(),
				type : "LineProperties",
				key : key,
				delta :{
					o : line[key],
					n : value
				},
				modelId : id
			};
			this.addCommand(command);
			this.modelLineProperties(id, key, value);
			this.render();
			this.commitModelChange()
		} else {
			console.warn("updateLineProperties() > No line with id " + id);
		}
	}


	modelLineProperties (id, key, value){
		var line = this.model.lines[id];

		if(line){
			line[key] = value;
			this.onModelChanged([{type: 'line', action:"change", id:id}]);
		} else {
			console.warn("modelLineProperties() > No line with id " + id);
		}
	}

	undoLineProperties (command){
		this.modelLineProperties(command.modelId, command.key, command.delta.o);
		this.render();
	}

	redoLineProperties (command){
		this.modelLineProperties(command.modelId, command.key, command.delta.n);
		this.render();
	}



	/**********************************************************************
	 * Line Properties
	 **********************************************************************/

	updateLineAllProperties (id, newLine){
		this.logger.log(0,"updateLineAllProperties", "enter >key : " + id );
		const line = this.model.lines[id];
		if(line){
			this.startModelChange()
			const command = {
				timestamp : new Date().getTime(),
				type : "LineAllProperties",
				delta :{
					o : line,
					n : newLine
				},
				modelId : id
			};
			this.addCommand(command);
			this.modelLineAllProperties(id, newLine);
			this.render();
			this.commitModelChange()
		} else {
			console.warn("updateLineAllProperties() > No line with id " + id);
		}
	}


	modelLineAllProperties (id, newLine){
		const line = this.model.lines[id];
		if (line){
			this.model.lines[id] = newLine;
			this.onModelChanged([{type: 'line', action:"change", id:id}]);
		} else {
			console.warn("modelLineProperties() > No line with id " + id);
		}
	}

	undoLineAllProperties (command){
		this.modelLineAllProperties(command.modelId, command.delta.o);
		this.render();
	}

	redoLineAllProperties (command){
		this.modelLineAllProperties(command.modelId, command.delta.n);
		this.render();
	}

	/**********************************************************************
	 * Box
	 **********************************************************************/

	updateBox (pos, box){

		if(pos.y){
			box.y = pos.y;
		}

		if(pos.x){
			box.x = pos.x;
		}

		if(pos.h){
			box.h = pos.h;
		}

		if(pos.w){
			box.w = pos.w;
		}

		if(box.x < 0){
			box.x = Math.abs(box.x);
			console.warn("updateBox() > Something strange happened, box.x < 0 ...");
		}

		if(box.y < 0){
			box.y = Math.abs(box.y);
			console.warn("updateBox() > Something strange happened, pox.y < 0 ...");
		}
	}


	/**********************************************************************
	 * Helper
	 **********************************************************************/

	getWidgetName (screenID, name){
		var screen = this.model.screens[screenID];
		if (screen){
			var children = screen.children;
			var names = {};
			for (let i = 0; i < children.length; i++){
				let widgetID = children[i];
				if (this.model.widgets[widgetID]) {
					let widget = this.model.widgets[widgetID];
					names[widget.name] = widget.id;
				} else {
					console.debug("No widget", widgetID);
				}
			}
			// also add names of parent screen widgets
			if(screen.parents && screen.parents.length > 0 ){
				for(let i = 0; i< screen.parents.length; i++){
					let parentID = screen.parents[i];
					let parent = this.model.screens[parentID];
					if (parent) {
						let parentChildren = parent.children;
						for (let j = 0; j < parentChildren.length; j++){
							let widgetID = parentChildren[j];
							if (this.model.widgets[widgetID]) {
								let widget = this.model.widgets[widgetID];
								names[widget.name] = widget.id;
							}
						}
					}
				}
			}
			return this.getUniqueName(name, names);
		} else {
			console.error("getWidgetName() > No screen", screenID);
		}
		return name;
	}

	getSceenName (name){
		var names = {};
		for (var id in this.model.screens){
			var screen =  this.model.screens[id];
			if (screen) {
				names[screen.name] = screen.id;
			} else {
				console.debug("getSceenName() > No screen", id);
			}
		}
		return this.getUniqueName(name, names);
	}

	/**
	 * Returns a unique group name within the screen!!
	 */
	getGroupName (screenID, name){
		const names = {};
		for (let id in this.model.groups){
			const group =  this.model.groups[id];
			if (group) {
				if (group.children.length > 0){
					const widgetID = group.children[0];
					const widget = this.model.widgets[widgetID];
					if (widget) {
						const parentScreen = this.getParentScreen(widget);
						if (parentScreen && parentScreen.id === screenID) {
							names[group.name] = group.id;
						}
					}
				}
				// we are missung the sub groups here, or parent groups...
			} else {
				console.debug("getGroupName() > No group", id);
			}
		}
		return this.getUniqueName(name, names);
	}

	/**
	 * Create a unique name in a screen by adding an count add the end. If there is already a count,
	 * we have to remove it
	 */
	getUniqueName  (name, names) {
		// if the name is unique simply return
		if (!names[name]){
			return name;
		}
		// else reduce to base bz assuming "<String> <Int>" pattern
		var pos = name.lastIndexOf(" ");
		if (pos > 0) {
			var end = name.substring(pos+1);
			var er = /^-?[0-9]+$/;
			var isInt =  er.test(end);
			if (isInt){
				name = name.substring(0, pos);
			}
		}
		if (!names[name]){
			return name;
		}
		var count = 1;
		var newName = name;
		while (names[newName] && count < 1000) {
			newName = name + " " + count;
			count++;
		}
		return newName;
	}

	getInlineEdit (){
		if (this._canvas){
			return this._canvas.inlineEditGetCurrent();
		}
	}

	getUUID (){
		/**
		 * We add here a random number, to avoid collisions in collab sessions. Using UUIDs would
		 * be better, hwoever the Core.getOrderedWidgets() relies for old prototypes
		 * on the id to establish order.
		 */
		const uuid = this.model.lastUUID++ + "_" + Math.round(Math.random() * 100000);
		return uuid
	}

	getLastChangedWidget (type){
		if (this._lastChangedWidgets && this._lastChangedWidgets[type]){
			return this._lastChangedWidgets[type];
		}
	}

	setLastChangedWidget (widget){
		if (this._lastChangedWidgets && widget){
			this._lastChangedWidgets[widget.type] = widget;
		}
	}

	createNiceName (w){
		return w.type;
	}

	getDeltaBox (model, pos){
		const delta = {n:{}, o:{}};
		if(model){
			for(let p in pos){
				if(pos[p] != null && pos[p]!= undefined){
					if(pos[p] != model[p]){
						delta.n[p] = pos[p];
						delta.o[p] = model[p];
						//ModelFixer.fix1PXBug(p, model, pos)
					}
				}
			}
		} else{
			this.logger.error("getDeltaBox", "no model passed ");
		}
		return delta;
	}



	getPropertyDelta (model, props, type){
		/**
		 * check if we have to handle templates in here!
		 */
		if(type == "style" && model.template){
			if(this.model.templates && this.model.templates[model.template]){
				var template = this.model.templates[model.template];
				return this.getDelta(template[type], props);
			} else {
				console.warn("No template with ", model.template);
			}
		} else {
			return this.getDelta(model[type], props);
		}
	}


	getDelta (model, pos){
		var delta = {n:{}, o:{}};
		for(var p in pos){
			if(pos[p] != model[p]){
				delta.n[p] = pos[p];
				if(model[p] != null){
					delta.o[p] = model[p];
				} else {
					/**
					 * This causes some serious troubles in vertx mongo
					 */
					delta.o[p] = null;
				}

			}
		}
		return delta;
	}

	logPageEvent (action, label) {
		this.logger.log(4,"logPageEvent","enter", action + " > " + label);
		try{
			// if(ga!=null && ga!=undefined){
			//	ga('send', {
			//	  hitType: 'event',
			//	  eventCategory: 'MATC',
			//	  eventAction: action,
			//	  eventLabel: label
			//	})
			//}
		} catch(err) {
			this.logger.error("logPageEvent","error", err);
		}
	}

	printWidget (id) {
		if (this.model.widgets[id]) {
			return this.model.widgets[id].name
		}
		return id + '[Not found]'
	}

	/**********************************************************************
	 * Model FIXES
	 **********************************************************************/









}