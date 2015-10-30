/**
 * SessionsController
 *
 * @description :: Server-side logic for managing sessions
 * @help        :: See http://links.sailsjs.org/docs/controllers
 */

var Orthogen = require('../../bindings/orthogen/index'),
  Elecdetec = require('../../bindings/elecdetec/index'),
  Wiregen = require('../../bindings/wiregen/index'),
  uuid = require('node-uuid'),
  fs = require('fs'),
  path = require('path'),
  mkdirp = require('mkdirp');
//  hardCodedPanoImage = '/tmp/panorama.jpg';
//var savePath = '/tmp';

// function createSession(param) {

//   return new Promise(function(resolve, reject) {
//     //var tmp = '73fe3ef2-4614-4830-bf40-b58147d52d47', //uuid.v4(), // Bygade72
//     //var tmp = '54334197-c970-42ff-a56f-384d0cc064c4', //uuid.v4(),   // Byagde72_2ndscan
//     //var tmp = 'byg72-1st-scan_fixed', //uuid.v4(),   // Byagde72_2ndscan
//     //  workingDir = path.join(savePath, tmp, '/tools/rise');

//     var sessionPath = session.sessionPath;
//     var sessionName = sessionPath.split('/').pop();
//     var workingDir = path.join(sessionPath, 'tools', 'rise');

//     mkdirp(workingDir, function(err) {
//       if (!err) {
//         console.log('[SessionController::Created session at path: ' + workingDir + ']');
//         console.log(sessionName);

//         session.workingDir = workingDir;
//         session.sessionId = sessionName;
//         session.status = 'created';

//         Rise.create(session, function(err, session) {
//           if (err) return reject(err);

//           session.status = 'pending';
//           session.save(function(err, saved_record) {
//             //console.log('session: ' + JSON.stringify(saved_record, null, 4));
//             resolve(session);
//           });
//         });
//       } else {
//         console.log('Error creating session directory. Aborting!');
//         console.log('  Error message: ' + err);
//         reject(err);
//       }

//     });
//   });

// }

function prepareSession(e57master) {
  var session = {};

    session.basename = path.basename(e57master, '.e57');
    session.workingDir = path.join(e57master, '..', '..', 'tools', 'rise');

    session.e57file = path.join(session.workingDir, "..", "..", "metadata", session.basename + "_e57metadata.json");
    session.wallfile = path.join(session.workingDir, "..", "..", "derivatives", session.basename + "_wall.json");
    session.panopath = path.join(session.workingDir, "pano");
    session.orthoresult = path.join(session.workingDir, "orthoresult");

    session.elecDir = 'elecdetect-test-set';
    session.elecdetecPath = path.join(session.workingDir, session.elecDir); 
    session.elecResultsDir = 'results';
    session.elecdetecResults = path.join(session.elecdetecPath, session.elecResultsDir);
    //console.log(JSON.stringify(session));
  return session;
}

function initializeSession(param) {
  return new Promise(function(resolve, reject) {
    session = prepareSession(param.e57master);
    resolve(session);
  });
}


function startOrthogen(param) {

  var session = prepareSession(param.e57master);

    mkdirp(session.orthoresult, function(err) {
      if (!err) {

        return new Promise(function(resolve, reject) {
          var orthogen = new Orthogen();
          orthogen.createOrthoImages(session).then(function(orthogen_result) {
            resolve(orthogen_result);
          });
        });

      } else {
        console.log('Error creating orthogen result directory. Aborting!');
        console.log('  Error message: ' + err);
        reject(err);
      }
    });
}

function startElecdetect(param) {

  var session = prepareSession(param.e57master);

  return new Promise(function(resolve, reject) {
    console.log('[SessionController::starting Elecdetect]');

    var elecdetect = new Elecdetec();
    var elecdetectConfig = elecdetect.defaultConfig();
    // parse elecdetect params
    if (param.config) {
      if (param.config.elecdetect) {
        console.log("reading elecdetect config:");
        for (var category in param.config.elecdetect) {
          for (var key in param.config.elecdetect[category]) {
            console.log(key + " : " + elecdetectConfig[category][key] +  " -> " + param.config.elecdetect[category][key]);
            elecdetectConfig[category][key] = param.config.elecdetect[category][key];
          }
        }
      }
    //elecdetectConfig.detection.detection_default_threshold = "0.4";
    //elecdetectConfig.detection.detection_label_thresholds = "0.2, 0.55";
    }
    console.log(elecdetect.config2ini(elecdetectConfig));

    resolve(elecdetect.createElecImages(session, elecdetectConfig));
    console.log("[SessionController::finished]");
  });
}

function startWiregen(param) {
  return new Promise(function(resolve, reject) {
    console.log('[SessionController::start Wiregen]');
    var session = prepareSession(param.e57master);

    var wiregen = new Wiregen();

    // collect elecdetect results
    var files = fs.readdirSync(session.elecdetecResults);
    session.elecDetecResultImages = [];
    for (var key in files) {
      var fileResult = {
        file: files[key],
        link: 'session/' + session.sessionId + '/' + session.elecDir + '/' + session.elecResultsDir + '/' + files[key]
      };
      session.elecDetecResultImages.push(fileResult);
    }

    resolve(wiregen.importDetections(session)
      .then(createInputSymbolList)
      .then(wiregen.createWiregenImages)
      .then(wireGenResultSvg_grammar)
      .then(wireGenResultSvg_hypothesis));
  });
}

function createInputSymbolList(session) {
  return new Promise(function(resolve, reject) {
    try {

      console.log('[SessionController::create Flat List]');

      console.log('reading from ' + session.wallfile);
      walljson = JSON.parse(fs.readFileSync(session.wallfile, "utf8"));

      // add symbols from wall json
      for (var ia in walljson)
      {
        walljson[ia].forEach(function(symbol){ 
          session.wiregenInput.push(symbol); 
        });
        console.log("imported " + walljson[ia].length + " " + ia + " symbols.");
      }
      // add sockets and switches
      [ 'Sockets', 'Switches'].forEach(function(category){
        session[category].forEach(function(symbol){ 
          session.wiregenInput.push(symbol); 
        });
        console.log("imported " + session[category].length + " " + category + " symbols.");
      });

      session.wiregenPath = path.join(session.workingDir, 'wiregen');
      session.wireGenFile = path.join(session.wiregenPath, 'wiregenInput.json');
      session.wireGenOutput = path.join(session.wiregenPath, 'output');
      mkdirp(session.wiregenPath, function(err) {
        mkdirp(session.wireGenOutput, function(err) {
          fs.writeFile(session.wireGenFile, JSON.stringify(session.wiregenInput), function(err) {
            if (err) reject(err);
            resolve(session);
          });
        });
      });
    } catch (e) {
      console.log(e);
      console.log(e.stack);
      reject(e);
    }


  });
}

// function wireGenResultSvg_grammar(session) {
//   return new Promise(function(resolve, reject) {
//     session.wireGenResultGrammar = [];
//     fs.readdir(path.join(session.wireGenOutput, 'svg_grammar'), function(err, files) {
//       for (var key in files) {
//         var fileResult = {
//           file: files[key],
//           link: 'session/' + session.sessionId + '/wiregen/output/svg_grammar/' + files[key]
//         };
//         session.wireGenResultGrammar.push(fileResult);
//       }
//       resolve(session);
//     });
//   });
// }

// function wireGenResultSvg_hypothesis(session) {
//   return new Promise(function(resolve, reject) {
//     session.wireGenResultHypothesis = [];
//     fs.readdir(path.join(session.wireGenOutput, 'svg_hypothesis'), function(err, files) {
//       for (var key in files) {
//         var fileResult = {
//           file: files[key],
//           link: 'session/' + session.sessionId + '/wiregen/output/svg_hypothesis/' + files[key]
//         };
//         session.wireGenResultHypothesis.push(fileResult);
//       }
//       resolve(session);
//     });
//   });
// }

// function reOrderResult(session) {
//   return new Promise(function(resolve, reject) {
//     try {


//       session.resultArray = {};
//       session.resultArray.elecDetecResults = [];
//       session.resultArray.orthogenResults = [];
//       session.resultArray.wireGenResultHypothesis = [];
//       session.resultArray.wireGenResultGrammar = [];

//       var baseUrl = 'session/' + session.sessionId + '/';
//       var wireGenGramarUrl = baseUrl + 'wiregen/output/svg_grammar/';
//       var wireGenHypothesisUrl = baseUrl + 'wiregen/output/svg_hypothesis/';
//       var elecDetedtUrl = baseUrl + '/elecdetect-test-set/results/';

//       var orderedResult = orderSession(session);

//       for (var i = 0; i < orderedResult.length; i++) {
//         var picture = orderedResult[i].attributes.id;
//         session.resultArray.wireGenResultGrammar.push(wireGenGramarUrl + picture + '.svg');
//         session.resultArray.wireGenResultHypothesis.push(wireGenHypothesisUrl + picture + '.svg');
//         session.resultArray.elecDetecResults.push(elecDetedtUrl + picture + '-result.jpg');
//         session.resultArray.orthogenResults.push(baseUrl + picture + '.jpg');
//       }

//       resolve(session);
//     } catch (e) {
//       console.log(e);
//       reject(session);
//     }
//   });
// }

// function orderSession(session) {
//   var tempWalls = session.Walls.slice(0);
//   var sorted = [];


//   while (tempWalls.length > 0) {
//     var first = tempWalls.pop();
//     sorted.push(first);
//     var corner = first.right;
//     while (corner != first.left) {
//       // find wall with left corner
//       var found = false;
//       for (var w in tempWalls) {
//         var wall = tempWalls[w];
//         if (wall.left == corner) {
//           sorted.push(wall);
//           corner = wall.right;
//           tempWalls.splice(w, 1);
//           found = true;
//           break;
//         }
//       }
//       if (found === false) {
//         console.log("loop not closed.");
//         break;
//       }
//     }
//   }
//   return sorted;
// }

module.exports = {
  /**
   * @api {post} /uploadFile Upload geometry file
   * @apiVersion 0.7.0
   * @apiName PostUploadFile
   * @apiGroup RISE
   * @apiPermission none
   *
   * @apiDescription Upload a new geometry file for RISE.
   *
   * @apiParam (File) {String} path Location of the File as provided by the [DURAARK Sessions API](http://data.duraark.eu/services/api/sessions/).
   * @apiParam {Number} ID of the internal Session the file should be added to.
   *
   */
  uploadFile: function(req, res, next) {

    var config = req.body;
    var workingDir = path.join(savePath, config.session);

    console.log('HomeDir: ' + workingDir);


    res.setTimeout(0);

    req.file('file').upload({
      dirname: path.resolve(sails.config.appPath, workingDir)
    }, function(err, uploadedFiles) {
      if (err) return res.negotiate(err);

      console.log(uploadedFiles[0].fd);

      return res.json({
        files: uploadedFiles,
        fileName: path.basename(uploadedFiles[0].fd),
        message: 'File uploaded successfully!'
      });
    });
  },

  /**
   * @api {post} /uploadPanoramas Upload panorama file
   * @apiVersion 0.7.0
   * @apiName PostUploadPanorama
   * @apiGroup RISE
   * @apiPermission none
   *
   * @apiDescription Upload a new panorama file for RISE.
   *
   * @apiParam (File) {File} file Upload of file via form data.
   * @apiParam {Number} ID of the internal Session the file should be added to.
   *
   */
  uploadPanoramas: function(req, res, next) {
    var config = req.body;
    var workingDir = path.join(savePath, config.session);

    console.log('HomeDir: ' + workingDir);


    res.setTimeout(0);

    req.file('file').upload({
      dirname: path.resolve(sails.config.appPath, workingDir)
    }, function(err, uploadedFiles) {
      if (err) return res.negotiate(err);

      return res.json({
        files: uploadedFiles,
        message: 'File uploaded successfully!'
      });
    });
  },

  /**
   * @api {post} /rise Extract electrical appliances
   * @apiVersion 0.7.0
   * @apiName PostRise
   * @apiGroup RISE
   * @apiPermission none
   *
   * @apiDescription Extract BIM model as IFC file with in-wall electrical appliances from given E57 point cloud file.
   *
   * @apiParam (File) {String} path Location of the File as provided by the [DURAARK Sessions API](http://data.duraark.eu/services/api/sessions/).
   *
   */
  rise: function(req, res, next) {

    req.connection.setTimeout(0);

    var session = req.body;
    session.panoImage = hardCodedPanoImage;

    createSession(session)
      .then(initializeSession)
      .then(startOrthogen)
      .then(startElecdetect)
      .then(startWiregen)
      .then(reOrderResult)
      .then(function(argument) {
        console.log('returning from everything');
        res.send(200, argument);
      }).catch(function(err) {
        console.log('Error: ' + err);
        res.send(500, err);
      });
  },


  createSession: function(req, res, next) {

    var session = req.body;

    createSession(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });

  },

  initializeSession: function(req, res, next) {

    var session = req.body;

    initializeSession(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });

  },


  createObjectFiles: function(req, res, next) {
    var session = req.body;

    createObjectFiles(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });
  },
  startOrthogen: function(req, res, next) {
    var session = req.body;

    startOrthogen(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });
  },
  startElecdetect: function(req, res, next) {
    var session = req.body;
    req.connection.setTimeout(0);

    startElecdetect(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });
  },
  startWiregen: function(req, res, next) {
    var session = req.body;
    //console.log(session);
    startWiregen(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });

  },
  reOrderResult: function(req, res, next) {
    reOrderResult(session).then(function(argument) {
      res.send(200, argument);
    }).catch(function(err) {
      console.log('Error: ' + err);
      res.send(500, err);
    });
  },

  roomInfo: function(req, res, next) {
    // var sessionId = req.param('sessionId'),
    // roomId = req.param('roomId');
    //var sessionId = 3,
    //    roomId = 'room11';
    //Rise.findOne(sessionId).then(function(session) {
    //  console.log('session: ' + JSON.stringify(session, null, 4));

      // TODO: find svgs for room
      var session = prepareSession(req.body.e57master);
      //console.log(JSON.stringify(session, null, 4));

      // read wall JSON
      walljson = JSON.parse(fs.readFileSync(session.wallfile, "utf8"));

      var ROOMS = {};
      var room2wall = {};
      
      // build room wall cycles
      for (var i in walljson.Walls)
      {
        var wall = walljson.Walls[i];
        // build room->walls index
        if (!room2wall[wall.attributes.roomid]) 
          room2wall[wall.attributes.roomid]=[];
          
        room2wall[wall.attributes.roomid].push(wall);
      }
  
      for (var roomid in room2wall)
      {
          // create new room
          room = {
            "label" : roomid,
            "walls" : []
          }
          // get ordered wall cycle
          unordered = room2wall[roomid].slice();
          ordered = [];
          while(unordered.length > 0)
          {
            var nocycle=true;
            if (ordered.length==0) {
              // start with any element
              ordered.push(unordered.pop());
            } else {
              var current = ordered[ordered.length-1];
              // find element "right" to the current one
              for (var i in unordered) {
                if (unordered[i].left == current.right) {
                  ordered.push(unordered[i]);
                  unordered.splice(i,1);
                  nocycle=false;
                  break;
                }
              }
              if (nocycle)  {
                console.log("error: non-closing cycle!");
                ordered.push(unordered.pop());
              }
            }
          }
          room.walls = ordered;
          ROOMS[room.label] = room;
      }

      var Room = ROOMS[req.body.roomid];
      if (Room) {

        // initialize roomdata
        roomdata = {
          "roomid" : Room.label,
          "rise" : {
            "wallids" : [],
            "orthophoto" : { "walls" : [ ] },
            "grammar"    : { "walls" : [ ] },
            "hypothesis" : { "walls" : [ ] }
          }
        };

        for (i=0; i<Room.walls.length; ++i)
        {
          var wallid = Room.walls[i].attributes.id;
          roomdata.rise.wallids.push(wallid);
          var httpbase = "/rise/";
          roomdata.rise.orthophoto.walls.push(httpbase + "orthoresult/" + session.basename + "_" + wallid + ".jpg");
          roomdata.rise.grammar.walls.push(httpbase + "wiregen/output/svg_grammar/" + wallid + ".svg");
          roomdata.rise.hypothesis.walls.push(httpbase + "wiregen/output/svg_hypothesis/" + wallid + ".svg");
        }

        console.log(JSON.stringify(roomdata, null, 4));

        res.send(200, roomdata);
      } else {
        // Room id not found
        res.send(404, "room id not found.");
      }

    }
};