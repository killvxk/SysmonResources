var OrientDB = require('orientjs');
var server = OrientDB({host: 'myorientdb', port: 2424});
var db = server.use({name: 'DataFusion', username: 'root', password: 'Password1234', useToken : true});


// === helper functions ===

function escapeLine(jsonline){
    return jsonline
}


// ==== Stage 2 - Run payload ====

/* Legend: FromClass-[EdgeClassName:PropertiesToLinkWith]->ToClass
 * Summary: Create ParentOf Edge for ProcessCreate Parent-Child vertices.
 * Description: Uses OrientDB Live Query to create edges when vertices are inserted.
 *              ProcessCreate-[ParentOf:ProcessGuid,Hostname]->ProcessCreate 
 * @param {inserted vertex} data
*/
db.liveQuery("live select from ProcessCreate")
  .on('live-insert', function(inserted){
     var child = inserted.content;
     console.log('inserted ProcessCreate ' + child.Image);  
     db.query("SELECT @rid FROM ProcessCreate WHERE ProcessGuid = :guid \
                  AND Hostname = :hostname",
                  {params:{
                        guid: child.ParentProcessGuid,
                        hostname: child.Hostname
                       },
                  limit: 1}
            ).then(function(parent){
                if(parent.length > 0) { //when parent ProcessCreate event exist
                    console.log('Found ProcessCreate Parent')
                    console.log(JSON.stringify(parent[0].rid));   
                    //create edge between parent to current vertex
                    db.query('CREATE EDGE ParentOf FROM :rid TO (SELECT FROM ProcessCreate \
                             WHERE ProcessGuid = :guid AND Hostname = :hostname)',
                              {
                                 params:{
                                    rid: parent[0]['rid'],
                                    guid: child.ProcessGuid,
                                    hostname: child.Hostname
                                   }
                              }
                    );
                  }
                  
            });
  })



// Using RecordNumber together with ProcessGuid because the lack of @rid from OrientJS for live-query.
db.liveQuery("live select from CreateRemoteThread")
  .on('live-insert', function(data){
     var CreateRemoteThread = data.content;
     // ProcessCreate-[CreatedRemoteThread:SourceProcessGuid]->CreateRemoteThread
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = :guid AND Hostname = :hostname',
              {params:{
                  guid: CreateRemoteThread.SourceProcessGuid,
                  hostname: CreateRemoteThread.Hostname
                 },
               limit: 1}
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    db.query('CREATE EDGE CreatedThread FROM :rid TO \
                     (SELECT FROM CreateRemoteThread WHERE RecordNumber = :recordno \
                      AND SourceProcessGuid = :guid AND Hostname = :hostname',
                    {
                        params:{
                           rid: ProcessCreate[0].rid,
                           recordno: CreateRemoteThread.RecordNumber,
                           guid: CreateRemoteThread.SourceProcessGuid,
                           hostname: CreateRemoteThread.Hostname
                          }
                     }
                  );
              }
            });

      // CreateRemoteThread-[RemoteThreadFor:TargetProcessId]->ProcessCreate
      // this may have a problem because what if ProcessId is being reused in same host?
      db.query('SELECT @rid FROM ProcessCreate WHERE ProcessId = :pid AND Hostname = :hostname',
                        {params:{
                              pid: CreateRemoteThread.TargetProcessId,
                              hostname: CreateRemoteThread.Hostname
                        },
                        limit: 1}
                  ).then(function(ProcessCreate){
                        if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                              cmd = 'CREATE EDGE RemoteThreadFor FROM (SELECT FROM CreateRemoteThread WHERE RecordNumber = ' 
                              + CreateRemoteThread.RecordNumber + ' AND SourceProcessGuid = "' + CreateRemoteThread.SourceProcessGuid + 
                              '" AND Hostname = "' + escapeLine(CreateRemoteThread.Hostname) + '") TO ' + ProcessCreate[0].rid;
                              //console.log('command: ' + cmd);
                              db.query(cmd);
                }                
          });
  })

// ==== Stage 2 - Install Payload / Persistence ====

// ProcessCreate-[WroteFile:ProcessGuid,Hostname]->FileCreate
db.liveQuery("live select from FileCreate")
  .on('live-insert', function(data){
     var FileCreate = data.content;
     //console.log('inserted: ' + JSON.stringify(FileCreate));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + FileCreate.ProcessGuid + '" AND Hostname = "' + escapeLine(FileCreate.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE WroteFile FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM FileCreate WHERE RecordNumber =' + FileCreate.RecordNumber + 
                          ' AND ProcessGuid = "' + FileCreate.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(FileCreate.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }                  
            });
   })

// FileCreate-[UsedAsDriver:TargetFilename=ImageLoaded]->DriverLoad
db.liveQuery("live select from DriverLoad")
  .on('live-insert', function(data){
     var DriverLoad = data.content;
     //console.log('inserted: ' + JSON.stringify(DriverLoad));
     db.query('SELECT @rid FROM FileCreate WHERE TargetFilename = "' 
              + escapeLine(DriverLoad.ImageLoaded) + '" AND Hostname = "' + escapeLine(DriverLoad.Hostname) + '"'
            ).then(function(FileCreate){
                  if(FileCreate.length > 0) { //when FileCreate event exist
                    cmd = 'CREATE EDGE UsedAsDriver FROM ' + FileCreate[0].rid + 
                          ' TO (SELECT FROM DriverLoad WHERE RecordNumber =' + DriverLoad.RecordNumber + 
                          ' AND ImageLoaded = "' + escapeLine(DriverLoad.ImageLoaded) +
                          '" AND Hostname = "' + escapeLine(DriverLoad.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
            });
   })


db.liveQuery("live select from ImageLoad")
  .on('live-insert', function(data){
     var ImageLoad = data.content;
     //console.log('inserted: ' + JSON.stringify(ImageLoad));
     // ProcessCreate-[LoadedImage:ProcessGuid,Hostname]->ImageLoad
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = :guid AND Hostname = :hostname',
              {params:{
                       guid: ImageLoad.ProcessGuid,
                       hostname: ImageLoad.Hostname
                      },
               limit: 1
              }
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE LoadedImage FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM ImageLoad WHERE RecordNumber =' + ImageLoad.RecordNumber + 
                          ' AND ProcessGuid = "' + ImageLoad.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(ImageLoad.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
            });
      // FileCreate-[UsedAsImage:TargetFilename=ImageLoaded]->ImageLoad
      db.query('SELECT @rid FROM FileCreate WHERE TargetFilename = "' 
            + escapeLine(ImageLoad.ImageLoaded) + '" AND Hostname = "' + escapeLine(ImageLoad.Hostname) + '"'
          ).then(function(FileCreate){
                if(FileCreate.length > 0) { //when FileCreate event exist
                  cmd = 'CREATE EDGE UsedAsImage FROM ' + FileCreate[0].rid + 
                        ' TO (SELECT FROM ImageLoad WHERE RecordNumber =' + ImageLoad.RecordNumber + 
                        ' AND ImageLoaded = "' + escapeLine(ImageLoad.ImageLoaded) +
                        '" AND Hostname = "' + escapeLine(ImageLoad.Hostname) + '")';
                  //console.log('command: ' + cmd);
                  db.query(cmd);
                }
          });
   })


db.liveQuery("live select from RegistryEvent")
  .on('live-insert', function(data){
     var RegistryEvent = data.content;
     //console.log('inserted: ' + JSON.stringify(RegistryEvent));
     // ProcessCreate-[AccessedRegistry:ProcessGuid,Hostname]->RegistryEvent
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + RegistryEvent.ProcessGuid + '" AND Hostname = "' + escapeLine(RegistryEvent.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE AccessedRegistry FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM RegistryEvent WHERE RecordNumber =' + RegistryEvent.RecordNumber + 
                          ' AND ProcessGuid = "' + RegistryEvent.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(RegistryEvent.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
            });
      // FileCreateStreamHash-[FoundWithin:TargetFilename in Details]->RegistryEvent
      // this assumes ADS created first before the registry event. Another case later which is the reverse
      db.query('SELECT @rid FROM FileCreateStreamHash LET $re = (SELECT FROM RegistryEvent WHERE Details = "' 
              + RegistryEvent.Details + '" AND RecordNumber = ' + RegistryEvent.RecordNumber + ') WHERE $re.Details.asString().indexOf(TargetFilename) > -1'
            ).then(function(FileCreateStreamHash){
                  if(FileCreateStreamHash.length > 0) { //when FileCreateStreamHash event exist
                    cmd = 'CREATE EDGE FoundWithin FROM ' + FileCreateStreamHash[0].rid + 
                          ' TO (SELECT FROM RegistryEvent WHERE RecordNumber =' + RegistryEvent.RecordNumber + 
                          ' AND ProcessGuid = "' + RegistryEvent.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(RegistryEvent.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
            });

   })

// ProcessCreate-[CreatedFileStream:ProcessGuid,Hostname]->FileCreateStreamHash   
db.liveQuery("live select from FileCreateStreamHash")
  .on('live-insert', function(data){
     var FileCreateStreamHash = data.content;
     //console.log('inserted: ' + JSON.stringify(FileCreateStreamHash));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + FileCreateStreamHash.ProcessGuid + '" AND Hostname = "' + escapeLine(FileCreateStreamHash.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE CreatedFileStream FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM FileCreateStreamHash WHERE RecordNumber =' + FileCreateStreamHash.RecordNumber + 
                          ' AND ProcessGuid = "' + FileCreateStreamHash.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(FileCreateStreamHash.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
            });            
      // FileCreateStreamHash-[FoundWithin:TargetFilename in Details]->RegistryEvent
      // this assumes registry event was created first, then the ADS   
      db.query('SELECT @rid FROM RegistryEvent WHERE Hostname = "' 
            + escapeLine(FileCreateStreamHash.Hostname) + '" AND Details.asString().indexOf("' + FileCreateStreamHash.TargetFilename + '") > -1'
          ).then(function(RegistryEvent){
                if(RegistryEvent.length > 0) { //when RegistryEvent event exist
                  cmd = 'CREATE EDGE FoundWithin FROM (SELECT FROM FileCreateStreamHash WHERE RecordNumber = ' + FileCreateStreamHash.RecordNumber + 
                        ' AND ProcessGuid = "' + FileCreateStreamHash.ProcessGuid +
                        '" AND Hostname = "' + escapeLine(FileCreateStreamHash.Hostname) + '") TO ' + RegistryEvent[0].rid;
                  //console.log('command: ' + cmd);
                  db.query(cmd);
                }
            });
   })


// ProcessCreate-[AccessedWMI:ProcessGuid,Hostname]->WmiEvent
db.liveQuery("live select from WmiEvent")
  .on('live-insert', function(data){
     var WmiEvent = data.content;
     //console.log('inserted: ' + JSON.stringify(WmiEvent));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + WmiEvent.ProcessGuid + '" AND Hostname = "' + escapeLine(WmiEvent.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE AccessedWMI FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM WmiEvent WHERE RecordNumber =' + WmiEvent.RecordNumber + 
                          ' AND ProcessGuid = "' + WmiEvent.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(WmiEvent.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

// ProcessCreate-[Terminated:ProcessGuid,Hostname]->ProcessTerminate     
db.liveQuery("live select from ProcessTerminate")
  .on('live-insert', function(data){
     var ProcessTerminate = data.content;
     //console.log('inserted: ' + JSON.stringify(ProcessTerminate));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + ProcessTerminate.ProcessGuid + '" AND Hostname = "' + escapeLine(ProcessTerminate.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE Terminated FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM ProcessTerminate WHERE RecordNumber =' + ProcessTerminate.RecordNumber + 
                          ' AND ProcessGuid = "' + ProcessTerminate.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(ProcessTerminate.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

// Stage 2 & 3 - External/Internal C2 ====

// ProcessCreate-[ConnectedTo:ProcessGuid,Hostname]->NetworkConnect
db.liveQuery("live select from NetworkConnect")
  .on('live-insert', function(data){
     var NetworkConnect = data.content;
     //console.log('inserted: ' + JSON.stringify(NetworkConnect));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + NetworkConnect.ProcessGuid + '" AND Hostname = "' + escapeLine(NetworkConnect.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE ConnectedTo FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM NetworkConnect WHERE RecordNumber =' + NetworkConnect.RecordNumber + 
                          ' AND ProcessGuid = "' + NetworkConnect.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(NetworkConnect.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

// ProcessCreate-[CreatedPipe:ProcessGuid,Hostname]->PipeCreate
db.liveQuery("live select from PipeCreated")
  .on('live-insert', function(data){
     var PipeCreated = data.content;
     //console.log('inserted: ' + JSON.stringify(PipeCreate));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + PipeCreated.ProcessGuid + '" AND Hostname = "' + escapeLine(PipeCreated.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE CreatedPipe FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM PipeCreated WHERE RecordNumber =' + PipeCreated.RecordNumber + 
                          ' AND ProcessGuid = "' + PipeCreated.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(PipeCreated.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

// ProcessCreate-[ConnectedPipe:ProcessGuid,Hostname]->PipeConnected
db.liveQuery("live select from PipeConnected")
  .on('live-insert', function(data){
     var PipeConnected = data.content;
     //console.log('inserted: ' + JSON.stringify(PipeConnected));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + PipeConnected.ProcessGuid + '" AND Hostname = "' + escapeLine(PipeConnected.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE ConnectedPipe FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM PipeConnected WHERE RecordNumber =' + PipeConnected.RecordNumber + 
                          ' AND ProcessGuid = "' + PipeConnected.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(PipeConnected.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

// ==== Stage 3 Capture Credentials - eg. Mimikatz ====

db.liveQuery("live select from ProcessAccess")
  .on('live-insert', function(data){
     var ProcessAccess = data.content;
     //console.log('inserted: ' + JSON.stringify(ProcessAccess));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + ProcessAccess.SourceProcessGuid + '" AND Hostname = "' + escapeLine(ProcessAccess.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    // ProcessCreate-[ProcessAccessed:SourceProcessGuid]->ProcessAccess
                    cmd = 'CREATE EDGE ProcessAccessed FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM ProcessAccess WHERE RecordNumber =' + ProcessAccess.RecordNumber + 
                          ' AND SourceProcessGuid = "' + ProcessAccess.SourceProcessGuid +
                          '" AND Hostname = "' + PescapeLine(rocessAccess.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
      db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
            + ProcessAccess.TargetProcessGuid + '" AND Hostname = "' + escapeLine(ProcessAccess.Hostname) + '"'
          ).then(function(ProcessCreate){
                if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                  // ProcessAccess-[ProcessAccessedFrom:TargetProcessGuid]->ProcessCreate
                  cmd = 'CREATE EDGE ProcessAccessedFrom FROM (SELECT FROM ProcessAccess WHERE RecordNumber = ' 
                  + ProcessAccess.RecordNumber + ' AND TargetProcessGuid = "' + ProcessAccess.TargetProcessGuid + 
                  '" AND Hostname = "' + escapeLine(ProcessAccess.Hostname) + '") TO ' + ProcessCreate[0].rid;
                  //console.log('command: ' + cmd);
                  db.query(cmd);
                }
                
          });
   })



// Stage 4 - Steal ==== (Doesn't mean every RawAccessRead = stealing!)
// ProcessCreate-[RawRead:ProcessGuid,Hostname]->RawAccessRead
db.liveQuery("live select from RawAccessRead")
  .on('live-insert', function(data){
     var RawAccessRead = data.content;
     //console.log('inserted: ' + JSON.stringify(RawAccessRead));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + RawAccessRead.ProcessGuid + '" AND Hostname = "' + escapeLine(RawAccessRead.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE RawRead FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM RawAccessRead WHERE RecordNumber =' + RawAccessRead.RecordNumber + 
                          ' AND ProcessGuid = "' + RawAccessRead.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(RawAccessRead.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })


// Stage 4 - Tampering (Doesn't mean every FileCreateTime = tampering!)
// ProcessCreate-[ChangedFileCreateTime:ProcessGuid,Hostname]->FileCreateTime
db.liveQuery("live select from FileCreateTime")
  .on('live-insert', function(data){
     var FileCreateTime = data.content;
     //console.log('inserted: ' + JSON.stringify(FileCreateTime));
     db.query('SELECT @rid FROM ProcessCreate WHERE ProcessGuid = "' 
              + FileCreateTime.ProcessGuid + '" AND Hostname = "' + escapeLine(FileCreateTime.Hostname) + '"'
            ).then(function(ProcessCreate){
                  if(ProcessCreate.length > 0) { //when ProcessCreate event exist
                    cmd = 'CREATE EDGE ChangedFileCreateTime FROM ' + ProcessCreate[0].rid + 
                          ' TO (SELECT FROM FileCreateTime WHERE RecordNumber =' + FileCreateTime.RecordNumber + 
                          ' AND ProcessGuid = "' + FileCreateTime.ProcessGuid +
                          '" AND Hostname = "' + escapeLine(FileCreateTime.Hostname) + '")';
                    //console.log('command: ' + cmd);
                    db.query(cmd);
                  }
                  
            });
   })

//*/