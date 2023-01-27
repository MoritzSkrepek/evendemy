module.exports = function (server, config, production_mode) {
    var _ = require('underscore');
    var moment = require('moment');

    var imageService = require('../services/imageService');
    var userService = require('../services/userService');
    var meetingService = require('../services/meetingService');
    var mailService = require('../services/mailService');
    var calendarService = require('../services/calendarService');
    var diffService = require('../services/diffService');

    var mailConfig = config.mail.config;

    server.get('/meeting/:mid', function (req, res, next) {
        meetingService.getMeeting(req.params.mid).then(function (meeting) {
            res.send(meeting);
            return next();
        }, function (err) {
            if (err === '404') {
                res.send(404, { error: 'No meeting found.' });
            } else {
                res.send(500, { error: err });
            }
            return next();
        });
    });

    server.get('/meeting/:mid/calendar', function (req, res, next) {
        meetingService.getMeeting(req.params.mid).then(function (meeting) {
            const attachment =  calendarService.createICalAttachment(config, meeting);
            res.send(attachment);
        }, function (err) {
            if (err === '404') {
                res.send(404, { error: 'No meeting found.' });
            } else {
                res.send(500, { error: err });
            }
            return next();
        });
    });

    function getMailAdresses(dbUsers) {
        if (!dbUsers) {
            return [];
        }
        return _.map(dbUsers, function (x) { return x.email; })
    }

    server.post('/meeting', function (req, res, next) {
        meetingService.saveMeeting(req.body, req.username).then(function (meeting) {
            console.log('saved');
            //inform all users about the new meeting entry
            userService.getAllUsers().then(function (users) {
                var view;
                if (meeting.isIdea) {
                    view = mailService.renderAllTemplates(mailConfig.informAboutIdea, meeting, null);
                } else {
                    view = mailService.renderAllTemplates(mailConfig.informAboutMeeting, meeting, null);
                }
                var sendTo = getMailAdresses(users);
                mailService.sendMail(config, sendTo, view, null, production_mode);
            }, function (err) {
                res.send(500, { error: err });
                return next();
            });
            res.send(meeting);
            return next();
        }, function(err){
            res.send(500, { error: err });
            return next();
        });
    });

    function notifyAllAttendingUsers(meeting, username, templates, text, iCal){
        meetingService.getAttendingUsersForMid(meeting.mid).then(function (meeting_users){
            promises = _.map(meeting_users, function(mu){ 
                return userService.getUserByUsername(mu.username);
            });

            Promise.all(promises).then(function(mappedUsers){
                userService.getUserByUsername(username).then(function(user){
                    var view = mailService.renderAllTemplates(templates, meeting, user, text);
                    var sendTo = getMailAdresses(mappedUsers);
                    mailService.sendMail(config, sendTo, view, iCal, production_mode);
                });
            });
        });
    }

    server.post('/meeting/:mid/comment', function (req, res, next) {
        meetingService.addComment(req.params.mid, req.body).then(function (meeting) {
            if(meeting.isIdea){
                notifyAllAttendingUsers(meeting, req.user.uid, mailConfig.commentAddedToIdea, req.body.text, null);
            }else{
                notifyAllAttendingUsers(meeting, req.user.uid, mailConfig.commentAddedToMeeting, req.body.text, null);
            }
            res.send(meeting);
            return next();
        }, function (err) {
            res.send(500, { error: err });
            return next();
        })
    });

    server.put('/meeting/:mid', function (req, res, next) {

        if (req.params.mid !== undefined) {
            meetingService.getMeeting(req.params.mid).then(function(oldMeeting){
                meetingService.updateMeeting(req.params.mid, req.params).then(function (meeting) {
                    var diffResult = diffService.diff(oldMeeting.toJSON(), meeting.toJSON());
                    if(diffResult['startTime']!= null || diffResult['endTime'] || diffResult['date']){
                        //something important changed
                        let text = '';
                        if(meeting.startTime && meeting.endTime){
                            text = meeting.startTime + '-' + meeting.endTime + ' - ';
                        }

                        if(meeting.date){
                            text += moment(meeting.date).format("MM.DD.YYYY");
                        }
                        
                        const iCal = calendarService.createICalAttachment(config, meeting);
                        if(meeting.isIdea){
                            notifyAllAttendingUsers(meeting, meeting.username, mailConfig.dateChangedFromIdea, text, iCal);
                        } else {
                            notifyAllAttendingUsers(meeting, meeting.username, mailConfig.dateChangedFromMeeting, text, iCal);
                        }
                        
                    }
                    res.send(meeting);
                    return next();
                }, function (err) {
                    res.send(500, { error: err });
                    return next();
                });
            }, function (err) {
                res.send(500, { error: err });
                return next();
            });
        }
        else {
            res.send(500, { error: 'No mid specified' });
            return next();
        }
    });

    server.del('/meeting/:mid', function (req, res, next) {
        meetingService.getMeeting(req.params.mid).then(function (meeting) {
            if (meeting.isIdea) {
                notifyAllAttendingUsers(meeting, meeting.username, mailConfig.ideaDeleted, null, null);
            } else {
                notifyAllAttendingUsers(meeting, meeting.username, mailConfig.meetingDeleted, null, null);
            }
            
            meetingService.deleteMeeting(req.params.mid).then(function (meeting) {
                res.send(meeting);
                return next();
            }, function (err) {
                res.send(500, { error: err });
                return next();
            });
            
        });
    });

    server.get('/meeting/:mid/attendees', function (req, res, next) {
        if (req.params.mid !== undefined) {
            meetingService.getAttendingUsersForMid(req.params.mid).then(function (meeting_users) {
                res.send(meeting_users);
                return next();
            }, function (err) {
                res.send(500, { error: err });
                return next();
            });
        } else {
            res.send(500, { error: 'no mid specified' });
            return next();
        }
    });

    server.put('/meeting/:mid/attendee/:username/attend', function (req, res, next) {
        console.log('try to attend');
        if (req.params.mid === undefined || req.params.username === undefined ) {
            res.send(500, { error: 'no mid or username' });
            return next();
        }

        meetingService.attendingToMeeting(req.params.mid, req.params.username, req.params.externals).then(function (meeting_user) {
            //send mail to the new attendee
            meetingService.getMeeting(req.params.mid).then(function (meeting) {
                if (meeting !== null) {
                    userService.getUserByUsername(req.params.username).then(function (user) {
                        confirmAttendee(meeting, user);
                        notifyAuthor(true, meeting, user);
                    }, function (err) {
                        console.error('post of meeting_user, user not found to send mail: ' + req.params.username + err);
                    });
                }
            }, function (err) {
                console.error('post of meeting_user, meeting not found with mid:' + req.params.mid + ", can not send a mail");
                return;
            })

            res.send(meeting_user);
            return next();
        }, function (err) {
            res.send(500, { error: err });
            return next();
        });
    });

    server.del('/meeting/:mid/attendee/:username/attend', function (req, res, next) {

        if (req.params.mid === undefined || req.params.username === undefined) {
            res.send(500, { error: 'No mid or username specified' });
            return next();
        }

        var meetingPromise = meetingService.getMeeting(req.params.mid);
        var userPromises = userService.getUserByUsername(req.params.username);

        Promise.all([meetingPromise, userPromises]).then(function([meeting, user]) {
            if(meeting!= null && user != null){
                if(req.params.username === req.user.uid) {
                    // user doenst want to attend anymore
                    meetingService.notAttendingToMeeting(req.params.mid, req.params.username).then(function (meeting_user) {
                        notifyAuthor(false, meeting, user);
                        res.send(meeting_user);
                    }, function (err) {
                        res.send(500, { error: err });
                        return next();
                    });
                } else if(meeting.username === req.user.uid) { 
                    // author rejects the participant
                    meetingService.notAttendingToMeeting(req.params.mid, req.params.username).then(function (meeting_user) {
                        if(meeting.isIdea){
                            notifyUser(mailConfig.notificationMail.ideaParticipationRejected, user, meeting);
                        }else{
                            notifyUser(mailConfig.notificationMail.meetingParticipationRejected, user, meeting);
                        }
                        res.send(meeting_user);
                        return next();
                    }, function (err) {
                        res.send(500, { error: err });
                        return next();
                    });
                } else {
                    res.send(403, { error: 'Forbidden' });
                    return next();
                }
            }
        }).catch( err => {
            res.send(500, { error: err });
            return next();
        });
    });

    server.put('/meeting/:mid/attendee/:username/confirm', function (req, res, next) {

        if (req.params.mid === undefined || req.params.username === undefined ) {
            res.send(500, { error: 'no mid or username' });
            return next();
        }

        meetingService.confirmUserForMeeting(req.params.mid, req.params.username).then(function (meeting_user) {
            res.send(meeting_user);
            return next();
        }, function (err) {
            res.send(500, { error: err });
            return next();
        });
    });

    server.del('/meeting/:mid/attendee/:username/confirm', function (req, res, next) {

        if (req.params.mid === undefined || req.params.username === undefined ) {
            res.send(500, { error: 'no mid or username' });
            return next();
        }

        meetingService.rejectUserFromMeeting(req.params.mid, req.params.username).then(function (meeting_user) {
            res.send(meeting_user);
            return next();
        }, function (err) {
            res.send(500, { error: err });
            return next();
        });
    });

    function confirmAttendee(meeting, user) {
        var template = meeting.isIdea ? mailConfig.confirmIdea : mailConfig.confirmMeeting;
        var view = mailService.renderAllTemplates(template, meeting, user);
        if (!meeting.date || !meeting.startTime || !meeting.endTime) {
            view.body = mailService.renderTemplate(template.body_no_calendar, meeting, user);
        }

        var sendTo = user.email;

        const attachment = calendarService.createICalAttachment(config, meeting);
        
        mailService.sendMail(config, sendTo, view, attachment, production_mode);
    }

    function notifyAuthor(isNewAttendee, meeting, attendee) {
        console.log('notify', isNewAttendee, meeting, attendee);
        userService.getUserByUsername(meeting.username).then(function (author) {

            var view;
            if(isNewAttendee){
                if(meeting.isIdea){
                    view = mailService.renderAllTemplates(mailConfig.notificationMail.newAttendeeForIdea, meeting, attendee);
                }else{
                    view = mailService.renderAllTemplates(mailConfig.notificationMail.newAttendeeForMeeting, meeting, attendee);
                }
            } else{
                if(meeting.isIdea){
                    view = mailService.renderAllTemplates(mailConfig.notificationMail.canceledAttendeeForIdea, meeting, attendee);
                }else{
                    view = mailService.renderAllTemplates(mailConfig.notificationMail.canceledAttendeeForMeeting, meeting, attendee);
                }
            }

            mailService.sendMail(config, author.email, view, null, production_mode);

        }, function (err) {
            console.error('notify via mail: ' + meeting.username + err);
        });
    }

    function notifyUser(mailTemplate, user, meeting) {
            var view = mailService.renderAllTemplates(mailTemplate, meeting, user);
            mailService.sendMail(config, user.email, view, null, production_mode);
    }

    server.post('/meeting/:mid/image', function (req, res, next) {
        if (!req.params.mid) {
            res.send(500, { error: 'No mid' });
            return next();
        }

        if (!req.params.data) {
            res.send(500, { error: 'No image' });
            return next();
        }

        imageService.save(req.params.mid, req.params.data, config.meetingImageFolder).then(function () {
            res.send(req.params.data);
            return next();
        }).catch(function (err) {
            console.log(err);
            res.send(500, { error: 'Image could not be saved.' });
            return next();
        });
    });
}