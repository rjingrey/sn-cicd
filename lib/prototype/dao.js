
const path = require("path");
const Promise = require('bluebird');

module.exports = function () {
    const self = this;

    /*

        TODO!!!!!!!!!!!
            currently the DB only supports the file to be in ONE version/ update-set
            - a file which is loaded from an update set has a newer timestamp than from master [OK]
            - what if the same file is also in another update set (of the same app)?
                - in that case the branch field must contain a updateOn value
                {
                    "branch": { 
                        "master" : 1540995225000, 
                        "va-test-@07cdc464dbd167c0432cfc600f9619e7" : 1538399625000
                        }
                    }

    */

    const detectCollision = function (applicationId, branch) {
        const newerFiles = [];
        return registerDataStore(applicationId).then(() => {
            const db = self.dataStore[applicationId];
            if (!db)
                return;
            
            // get all files from the current project
            return db.findAsync({ branch: branch }).then((files) => {
                if (!files.length)
                    return;
                /*
                    TODO: also search in the current applications for files in other branches!
                */
                return self.dataStore.application.findAsync({ _id: { $ne: applicationId } }).then((applications) => {
                    // check every app DB if there are newer files
                    return Promise.each(applications, ({ _id }) => {

                        return registerDataStore(_id).then(() => {
                            const appDb = self.dataStore[_id];
                            if (!appDb)
                                return;

                            let query;
                            if (_id !== applicationId) {
                                query = {
                                    _id: { $in: files.map((file) => file._id) }
                                };
                            } else {
                                query = {
                                    branch: { $nin: ['master', branch] },
                                    _id: { $in: files.map((file) => file._id) }
                                };
                            }
                                
                            return appDb.findAsync(query).then((sameFiles) => {
                                if (!sameFiles.length)
                                    return;

                                const sharedFiles = files.filter((file) => {
                                    return sameFiles.find((same) => {
                                        return (same._id == file._id)
                                    });
                                });

                                // check every file if there is a newer version
                                return Promise.each(sharedFiles, (file) => {
                                    return appDb.findAsync({
                                        _id: file._id,
                                        updatedOn: { $gt: file.updatedOn }
                                    }).then((newer) => {
                                        newer.forEach((newerFile) => {
                                            newerFiles.push({
                                                applicationId: _id,
                                                file: newerFile
                                            });
                                        });
                                    });
                                });
                            });
                        });
                        
                        
                    });
                });
                
            });
        }).then(()=>{
            return newerFiles;
        });

        
    };

    const registerDataStore = function (name) {
        return new Promise((resolve) => {
            if (self.dataStore[name]) {
                //console.log(`${name}.db is already registered`)
                return resolve(Object.keys(self.dataStore[name]).filter((k) => (k.endsWith('Async'))));
            }

            const Datastore = require('nedb');
            const coll = new Datastore({
                filename: path.join(self.settings.dataStore.path, 'projects', `${name}.db`),
                autoload: true
            });
            // add additional index
            coll.ensureIndex({ fieldName: 'branch' });

            Promise.promisifyAll(coll);
            self.dataStore[name] = coll;
            console.log(`successfully registered ${name}.db`);
            return resolve(Object.keys(self.dataStore[name]).filter((k) => (k.endsWith('Async'))));
        });
    };

    const getOperations = (table) => {
        return {
            get: (obj) => {
                const { _id } = (typeof obj == 'object') ? obj : { _id: obj };
                return self.dataStore[table].findOneAsync({
                    _id
                });
            },
            insert: (obj) => {
                if (!obj)
                    throw Error('Dao. insert() : No Object specified');
                return self.dataStore[table].insertAsync(obj);
            },
            update: (obj) => {
                if (!obj)
                    throw Error('Dao. update() : No Object specified');
                const { _id } = obj;
                if (!_id)
                    throw Error('Dao. update() : No _id specified');

                return self.dataStore[table].findOneAsync({ _id }).then((result) => {
                    if (result)
                        return self.dataStore[table].updateAsync({ _id }, obj);
                    return self.dataStore[table].insertAsync(obj);
                });
            },
            delete: ({ _id }) => {
                if (!_id)
                    throw Error('No _id specified');
                return self.dataStore[table].removeAsync({
                    _id
                });
            },
            find: (query) => {
                return self.dataStore[table].findAsync(query);
            },
            findOne: (query) => {
                return self.dataStore[table].findOneAsync(query);
            }
        };
    };
    const addDataSource = (tableName) => {
        collections[tableName] = getOperations(tableName);
    }

    const collections = {
        type: 'local',
        registerDataStore: (name) => {
            return registerDataStore(name).then((result) => {
                //console.log("registerDataStore [local]", result);
                collections[name] = self.dataStore[name];
                return result;
            });
        },
        detectCollision: detectCollision
    };

    ['application', 'us', 'run', 'step'].forEach((table) => {
        addDataSource(table);
    });

    return collections;
    
};