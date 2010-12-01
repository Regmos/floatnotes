//!#include "../header.js"

Cu.import("resource://floatnotes/URLHandler.js");
Cu.import("resource://floatnotes/preferences.js");

var EXPORTED_SYMBOLS = ['getManager'];

var manager = null;

function getManager(db) {
    if(manager === null) {
        manager = new FloatNotesManager(db);
    }
    return manager;
}


function FloatNotesManager(database) {
    this._db = database;
    this.notesByUrl = {};
    this.notes = {};
    this._observer_service = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
}

/**
 * FloatNotes global object prototype. Contains all the functions to load,
 * add, delete and save the notes.
 * 
*/
FloatNotesManager.prototype = {

    /**
      * Load and attach the notes
      */

    getNotesFor: function(location, cb) {
        LOG('Get notes for ' + location);

        var that = this;
        var domains = URLHandler.getSearchUrls(location);
        var domainsToFetch = [];
        var notesToReturn = [];

        for(var i = domains.length -1; i > -1; --i) {
            var domain = domains[i];
            var notes = this.notesByUrl[domain];
            if(!notes) {
                LOG('New to fetch: ' + domain);
                domainsToFetch.push(domain);
            }
            else {
                LOG('Chached for ' + domain + ': ' + notes.map(function(n){return n.guid;}).join(','));
                notesToReturn = notesToReturn.concat(notes); 
            }
        }
        if(domainsToFetch.length > 0) {
            this._db.getNotesForURLs(domainsToFetch, function(notesdata) {
                LOG('Manager loaded from DB: ' + notesdata.length + ' notes');
                var notesByUrl = that.notesByUrl;

                for (var i = 0, length = notesdata.length; i < length;i++) {
                    var data = notesdata[i];

                    if(typeof notesByUrl[data.url] == "undefined") {
                        notesByUrl[data.url] = [];
                    }
                    notesByUrl[data.url].push(data);
                    that.notes[data.guid] = data;
                }

                cb(notesToReturn.concat(notesdata));
            });
        }
        else {
            LOG('Everything cached');
            cb(notesToReturn);
        }

    },

    saveNote: function(data, cb) {
        // new or update ?
        var ID = data.id;

        if(typeof ID == "undefined") {
            this.addNote(data, cb);
        }
        else {
            this.updateNote(data, cb);
        }		
    },

    addNote: function(data, cb) {
        LOG('Save note for the first time.')
        var that = this;
        this._db.createNoteAndGetId(data, function(id, guid) {
            var domain = data.url;
            if(typeof that.notesByUrl[domain] == "undefined") {
                that.notesByUrl[domain] = [];
            }
            that.notesByUrl[domain].push(data);       
            that.notes[guid] = data;
            data.guid = guid;
            data.id = id;
            that._observer_service.notifyObservers(null, 'floatnotes-note-add', guid);
            if(typeof cb == 'function') {
                cb(id, guid);
            }
        });
    },

    updateNote: function(data, cb) {
        var that = this;
        var note = data;
        var ID = data.guid;
        if(this.notes[ID]) {
            note = this.notes[ID];
            if(note != data) {
                Util.Js.updateObject(note, data);
            }
        }
        note.modification_date = new Date();
        this._db.updateNote(note, function() {
            if(data._prevURL) {
                that.updateCacheForNewURL(note, data._prevURL, data.url);
                that._observer_service.notifyObservers(null, 'floatnotes-note-urlchange', note.guid);
                data._prevURL = null;
            }
            that._observer_service.notifyObservers(null, 'floatnotes-note-update', note.guid);
            if(typeof cb == 'function') {
                cb(-1, note.guid);
            }
        });
    },

    updateCacheForNewURL: function(note, oldURL, newURL) {
        if(!this.notesByUrl[newURL]) {
            this.notesByUrl[newURL] = [];
        }
        this.notesByUrl[newURL].push(note);
        Util.Js.removeObjectFromArray(note, this.notesByUrl[oldURL]);
    },

    createNote: function(document) {
        var domain = URLHandler.getDefaultUrl(document.location);
        var data = {
            w: Preferences.width,
            h: Preferences.height,
            content: "",
            url: domain,
            protocol: URLHandler.getProtocol(document.location),
            color: Preferences.color,
            status: 0};
        data.creation_date = data.modification_date = new Date();
        return data;
    },

    deleteNote: function(data, cb) {
        var that = this;
        var note = data;
        var ID = data.guid;
        var cached = false;

        if(typeof cb != 'function') {
            cb = function(){};
        }


        if(typeof ID  != 'undefined' && this.notes[ID]) {
            note = this.notes[ID];
            cached = true;
        }

        this._db.deleteNote(ID, function() {
            that._observer_service.notifyObservers(null, 'floatnotes-note-delete', note.guid);
            if(cached) {
                Util.Js.removeObjectFromArray(note, that.notesByUrl[note.url]);
                delete that.notes[note.url];
            }
            cb();
        });
    },

    siteHasNotes: function(location) {
        var domains = URLHandler.getSearchUrls(location);
        for(var i = domains.length -1; i > -1; --i) {
            var domain = domains[i];
            if( this.notesByUrl[domain] && this.notesByUrl[domain].length) {
                return true;
            }  
        }
        return false;
    }
};