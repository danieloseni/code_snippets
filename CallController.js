import OutgoingRinger from 'sounds/notifications/outgoing_ringtone.mp3';
import IncomingRinger from 'sounds/notifications/ringtone.mp3';
import {
    store
} from 'redux/store';
import {
    v4
} from 'uuid';
//Import the library responsible for sending and receiving messages via the socket, throughout the app.
import ChatWebSocketMessageBroker from 'adapters/WebsocketMessageBroker';

/**
 * This contraption handles real-time communication, in terms of video and voice calls, throughout this app. 
 * To break it down, here's the basic process the module works with:
 * 
 * Initialization:
 * - The front-end initializes the module by calling the initialize function with a set of callbacks for each event that might be raised by the module. These callbacks are
 *      a. onCallerDetailsSet: When a call request comes in, the caller would usually send an object containing the details of the who's calling such as their firstname, lastname and other things. When those details are sent, the onCallerDetailsSet callback is called and those details are passed
 *      b. onIncomingCallStatusChanged: Called when there is an incoming call, it is passed the callType(that is whether it is an audio call or a video call. type=audio if its an audio call and type=video if its a video call).
 *      c. onCallModalStateChanged: This the tells the frontend whether to show the call display or not and what type of call display it should show.
 *      d. onRemoteStreamAdded: This callback is called when the person on the other end adds their own stream. The stream is passed to the callback
 *      e. onLocalStreamAdded: This callback is called when the person on the current user's webcam is turned on.
 *      f. onCallTimeUpdated: Called for each second the call has been running with the total number of seconds spent.
 *      g. onAudioMuteStatusChanged: Called when the audio is muted or unmuted. It is called with the status
 *      h. onVideoMuteStatusChanged: Called when the video is turned off or on. Called with the video status.
 *      i. onCallStatusChanged: Called to update the current call status on the view. Can either be called with Reaching out or connecting or connected or Reconnecting
 * 
 * Initiation: 
 * - The initiation process is used to start a call. It involves sending message to the receiving party that the requester would like a call, then starting the ringtone on both ends if the other user is available. When the receiving party answers, the ringer is stopped on both ends and then the next stage begins. To initiate a cal, the frontend calls the start call function with its user's details and the type of call it would like to make either audio or video
 * 
 * Connection:
 * - Once the receiving party has agreed to have a call, the WebRTC connection phase starts. The phase includes exchanging ICEs, SDPs, and streams. the [createRtcPeerConnection] function is responsible for this.
 * 
 * Termination: 
 * - Upon rejection or ending a call, sever things happen. Since one function is responsible for both the rejection and ending of call, this stage feature many contrasting states. 
 *      a. First of all, the message to end the call is sent by the client who rejects or ends the call, over to the other client.
 *      b. Next, the rtc peer connection instance is destroyed, but before that, both local and remote streams are terminated.
 *      c. Next, the variable that indicates who the receiver of the call is (whether it is the client or the other side, or the current client) destroyed. This variable is important since both caller and receiver share one codebase. Therefore, decision that are crucial to either part have to be differentiated.
 *      d. Next, both incoming call ringer (on the receiver's side) and the outgoing ringer (on the caller's side) are stopped. This is because, remember, only one function handles both call rejections and ending. So both ringers are stopped if this was a rejection event.
 *      e. Next, the front-end is directed to close the call display via the onCallModalStateChanged callback.
 *      f. Next, the front-end is directed to close the incoming call popup that may be displayed, if this was a rejection event.
 *      g. Next, the call call timer is stopped and reset to 0, and the frontend is sent the new time.
 *      h. The call status is changed from connected to nothing
 *      i. Lastly, the initiationMessage received indicator is reset. 
 * All this is done to prepare the module for the next call.
 * 
 * That's it!!!
 * 
 * Tweak this module at your own peril.
 */


export default class CallController {
    //The variable that stores all the callbacks the module is initialized with
    static callbacks = {}

    //Initialize the ringer tunes
    static outgoingRinger = new Audio(OutgoingRinger);
    static incomingRinger = new Audio(IncomingRinger);

    //Prepare the variable that will store the RTCPeerConnection instance
    static rtcpeerconnection = null;

    //These variables store the intervals that are responsible for playing the ringers for a particular amount of seconds
    static incomingRingerTimeout = null;
    static outgoingRingerTimeout = null;

    //This variable stores the details of the person who is being called or the person who called. Depending on the standpoint of the client
    static friend = null;

    //This variable is used to indicate whether the current client is the receiver of the call or the initiator. It is needed since both parties share this singular codebase
    static receiver = false

    //this variable holds the local stream object
    static stream = null

    //this variable holds the remote stream object
    static remoteStream = null

    //Ths variable is used to store the total number of seconds that has been spent on the call
    static seconds = 0

    //This variable stores the interval that updates the number of seconds spent on the call
    static callTimeInterval = null;

    //This variables indicate whether the audio and video of the call have been muted respectively
    static audioMuted = false;
    static videoMuted = false;

    //This variable is here to correct a bug on the socket server, because it sometimes sends the messages twice 
    static initiationMessageSeen = false;

    //This is also used to correct the bug stated above. It keeps the ids of all the signaling messages that have come into the module. So that, if the server sends the same message twice, the second message would not be acknowledged
    static messageIds = []

    //This variable stores the interval that keeps track of how long the user has waited for his call to be picked before ending the call. It usually terminates the call if the user fails to respond withing 30 seconds.
    static intervalToEndCall = null

    //To ensure that signalling messages are not sent to multiple devices where the user is logged in, this variable stores the id of the device that was used to answer or initiate the call, so that subsequent messages can be forwarded to those devices only.
    static oppositeDevice = null




    /**
     * 
     * This function is responsible for subscribing to messages or signaling data meant for this module. It does so via the ChatWebSOcketMessageBroker module. Another utility module used throughout the app.
     */
    static connectSockets = () => {
        //subscribe to messages that have a type of "call". The subscribe function of the ChatWebSocketMessageBroker module takes 2 parameters, the type of message to subscribe to, a function that is passed the data,  when messages having that type are sent over.
        ChatWebSocketMessageBroker.subscribe("call", this.handleSignalingData)
    }




    /**
     * 
     * @param {Object} callbacks The list of callbacks to be used
     */
    //This function is responsible for initializing the module with all the necessary callbacks that might be used. The front-end calls this function and passes an object containing the callback functions
    static initialize = (
        callbacks = {

            onCallerDetailsSet: (friend) => {},
            onIncomingCallStatusChanged: (status, callType) => {},
            onCallModalStateChanged: (state, callType) => {},
            onRemoteStreamAdded: (stream) => {},
            onLocalStreamAdded: (stream) => {},
            onCallTimeUpdated: (seconds) => {},
            onAudioMuteStatusChanged: (status) => {},
            onVideoMuteStatusChange: (status) => {},
            onCallStatusChanged: (status) => {}
        }
    ) => {
        //Add all the callbacks to the callbacks variable
        this.callbacks = callbacks;
    }



    //Function responsible for keeping track of the number of seconds spent on the call and passing the total number of seconds back to the font-end
    static startCallTimer = () => {
        this.callTimeInterval = setInterval(() => {
            this.seconds += 1;
            this.callbacks.onCallTimeUpdated(this.seconds)
        }, 1000)
    }



    //Stops the call timer by clearing out the call timer's interval
    static stopCallTimer = () => {
        clearInterval(this.callTimeInterval)
    }


    /**
     * This function is responsible for setting up the interval that waits 30 seconds for the call to be picked of by the receiving party and ends the call if they fail to do so
     * @param {Function} onCut A callback for when the call is dropped.
     * @param {Function[]} actionsToCarryOutPerSecond An array of functions that should be executed for every seconds that is spent waiting for the receiver
     */
    static startIntervalToEndCall = (onCut, actionsToCarryOutPerSecond) => {
        let seconds = 30

        //Interval should wait for 30 seconds before ending call 
        this.intervalToEndCall = setInterval(() => {
            seconds -= 1;

            //Incase there are some actions that we would like to carry out each second until the interval runs out such as continually asking the client for a call
            actionsToCarryOutPerSecond ?.forEach?.(action => {
                action?.()
            })

            //Once 30 seconds is complete end the call and clear out the interval. ALso call the onCut callback if one was provided
            if (seconds === 0) {
                this.endCall()
                this.stopIntervalToEndCall()
                onCut?.()
            }
        }, 1000)
    }

    //Clears out the interval that keeps track of the waiting time before the call is picked
    static stopIntervalToEndCall = () => {
        clearInterval(this.intervalToEndCall)
        this.intervalToEndCall = null
    }

    //Sets up the incoming call interval and plays the incoming call ringer 20 times before stopping it
    static startIncomingRingerTimeout = () => {
        let ringTimes = 0
        this.incomingRingerTimeout = setInterval(() => {
            ringTimes += 1;
            //Call the function responsible for playing the ringer
            this.startIncomingRinger()
            if (ringTimes === 20) {
                this.stopIncomingRingerTimeout()

            }
        }, 12000)
    }


    //stops the incoming call ringer and clears its respective interval
    static stopIncomingRingerTimeout = () => {
        clearInterval(this.incomingRingerTimeout)
        this.stopIncomingRinger()
    }


    //Responsible for starting the outgoing call ringer, allow it to ring 20 times and then stopping it
    static startOutgoingRingerTimeout = () => {
        let ringTimes = 0
        this.outgoingRingerTimeout = setInterval(() => {
            ringTimes += 1;
            //call the function responsible for starting the outgoing call ringer
            this.startOutgoingRinger()

            if (ringTimes === 20) {
                this.stopOutgoingRingerTimeout()

            }
        }, 5000)
    }

    //Stops the outing call ringer and clears it corresponding interval 
    static stopOutgoingRingerTimeout = () => {
        clearInterval(this.outgoingRingerTimeout)
        this.stopOutgoingRinger()

    }

    //plays the outgoing call ringer
    static startOutgoingRinger = () => {
        try {
            this.outgoingRinger.play()
        } catch {
            this.startOutgoingRinger()
        }
    }

    //stops playing the outgoing call ringer
    static stopOutgoingRinger = () => {
        try {
            this.outgoingRinger.pause()
            this.outgoingRinger.currentTime = 0
        } catch {
            this.stopOutgoingRinger()
        }
    }


    //play the incoming call ringer
    static startIncomingRinger = () => {

        try {
            this.incomingRinger.play()
        } catch {
            this.startIncomingRinger()
        }
    }


    //stops playing the incoming call ringer
    static stopIncomingRinger = () => {
        try {
            this.incomingRinger.pause()
            this.incomingRinger.currentTime = 0
        } catch {
            this.stopIncomingRinger()
        }
    }


    //responsible for calling the callback that passes the remote stream to the front-end
    static updateRemoteStreamInView = () => {
        this.callbacks.onRemoteStreamAdded(this.remoteStream)
    }


    //responsible for calling the callback that passes the local stream to the front-end
    static updateLocalStreamInView = () => {
        this.callbacks.onLocalStreamAdded(this.stream)
    }


    //Starts up the user's webcam
    static getMedia = () => {

        //if the calltype is video, initialize the webcam with video option, if its audio, only use the audio option
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: !(this.callType === "audio")
        }).then(stream => {
            //store the local stream in the local stream variable 
            this.stream = stream

            //update the stream in the view
            this.updateLocalStreamInView()

        }).catch((err) => {})
    }

    //Mutes or un-mutes the audio in the local stream
    static muteUnMuteAudio = () => {
        //Adjust the audio muted indicator variable accordingly
        this.audioMuted = !this.audioMuted

        //Mute or un-mute all the audio tracks on the local stream
        this.stream.getAudioTracks()[0].enabled = !this.audioMuted

        //Tell the front end that the audio has been muted or unmuted
        this.callbacks.onAudioMuteStatusChanged(this.audioMuted)
    }

    //Stops and starts the video in the local stream
    static muteUnMuteVideo = () => {
        //Adjust the video muted indicator variable accordingly
        this.videoMuted = !this.videoMuted

        //Mute or un-mute all the video tracks on the local stream
        this.stream.getVideoTracks()[0].enabled = !this.videoMuted

        //Tell the front end that the audio has been muted or unmuted
        this.callbacks.onVideoMuteStatusChanged(this.videoMuted)
    }


    //Central signal message sender for this module
    static sendData = (json) => {
        json = {
            ...json,
            //Appends some commonly sent data with the data that is to be sent
            targetname: this.friend.username,
            sendername: store.getState().user.username,
            messageId: v4(),
            'friend': {
                ...store.getState().user,
                chatroom: this.friend.chatroom
            },
            device: this.oppositeDevice
        }


        //Uses the ChatWebsocketMessageBroker's send message function, that accepts 2 parameters, the type of message that is to be sent. So, that components listening for that type of message can be alerted. Such as the module. It also accepts the data to be sent and the socket id through which the message is to be sent.
        ChatWebSocketMessageBroker.sendMessage("sent", json, this.friend.chatroom)
    }


    //Responsible for initiating the call. The method is called by the front-end. The friend who is to be called is passed, alongside the type of call to be made. Video or audio.
    static startCall = (friend, callType) => {
        //Set the general friend flag as well as the callback
        this.friend = friend;
        this.callType = callType

        //Tell the frontend to set its caller details as well
        this.callbacks.onCallerDetailsSet(friend)

        //TODO: Initiate webcam and add stream
        this.getMedia()

        //Tell the front-end to display the appropriate call view. 
        this.callbacks.onCallModalStateChanged(true, this.callType)

        //Update the call status in the view to reaching out. Reaching out indicates that a call request has been sent to the receiver and should they be available, the outgoing call ringer would start 
        this.callbacks.onCallStatusChanged("Reaching out")

        //The initiate function sends out the initiation message. The message requesting a  call from the receiver
        this.initiate()

        //Start the waiting interval and pass a function that displays an error modal if the user is not available
        this.startIntervalToEndCall(
            () => {
                window.showPopup({
                    status: "failed",
                    text: `${this.friend?.firstname} is not available for a call right now`
                })
            }
        )
    }


    //Sends out the initiation message to the receiver, asking them if they are interested in a call. The details of the sender are also sent along
    static initiate = () => {

        this.sendData({
            'type': 'user_here',
            'message': 'Are you ready for a call?',
            callType: this.callType,
            'uname': this.friend.username,
            'room': "SIGNAL_ROOM",
            device: store.getState().user.device

        });

    }


    //After the initiation message is sent, if the receiver is available, a "ring" status is sent back telling the caller that the user is available. This function is called and immediately starts the outgoing ringer and updates the front-end accordingly
    static ring = () => {
        //TODO: Start the ringer
        this.startOutgoingRingerTimeout()

        //TODO: Update the call status on the view
        this.callbacks.onCallStatusChanged("Ringing...")

        //TODO: Reset Interval to end call
        this.stopIntervalToEndCall();

        this.startIntervalToEndCall()
    }


    /**
     * This function handles incoming signaling data for this module
     * @param {Object} data The data that is sent in
     * 
     */
    static handleSignalingData = (data) => {
        //data = JSON.parse(data.data)

        //Sometimes the socket sends the message twice so as the message comes in include their ids in the messageIds array of the class if they have not been included there before or don't do anything if they have, because it indicates that the message is a duplicate
        if (this.messageIds.includes(data.messageId)) return

        this.messageIds.push(data.messageId)

        //THe signaling data is usually broadcasted, and that means that both sender and receiver receive the message that is sent. Therefore, check if the client was the one who sent the message,if they are, terminate the function
        if (data.friend.id === store.getState().user.userId || (store.getState().user.device !== data.device && data.device)) return

        //if the type of data is a request message, start preparing for a call
        if (data.type === "user_here") {
            //Incase the socket server sends the initiation message twice, ensure that the initiation only takes place once
            if (this.initiationMessageSeen) return

            //If initiation hasn't taken place carry on. Update the initiation variable.
            this.initiationMessageSeen = true

            //TODO: Set friend variable
            this.friend = data.friend

            // TODO: Start the incoming call ringer
            this.startIncomingRingerTimeout()

            //TODO: Set caller info
            this.callbacks.onCallerDetailsSet(data.friend)

            //TODO: Set the call type
            this.callType = data.callType

            //TODO: Show incoming call dialog
            this.callbacks.onIncomingCallStatusChanged(true, this.callType)

            //TODO: Set the receiver variable
            this.receiver = true

            //TODO: Tell the calling party to ring
            this.sendData({
                type: "ring"
            })

            //TODO: Save the opposite device's id
            this.oppositeDevice = data.device




            //If the type of data sent is an SDP handle that as well
            if (data.type === "SDP") {
                //If the user is not currently on a call and he is the receiver of the call, create a peer connection instance. The caller would usually be the one to initiate SDP sending, so the receiver has to act accordingly.
                if (!this.rtcpeerconnection && this.receiver) {
                    this.createPeerConnection()
                }

                //Parse the sdp from the body of the data
                let message = JSON.parse(data.message);


                //Add the session description to the RTCPeerConnection instance and generate an SDP resonse
                this.rtcpeerconnection.setRemoteDescription(
                    new RTCSessionDescription(message.sdp),
                    () => {
                        if (this.rtcpeerconnection.remoteDescription.type === 'offer') {
                            //generate an SDP and send it to the user via the sendLocalDescription function
                            this.rtcpeerconnection.createAnswer(this.sendLocalDesc, this.logError);
                        }
                    }, this.logError);


            }
            //If the message type is an ice_candidate, create an RTCPeerConnection instance if there isn't any already
            else if (data.type === "ice_candidate") {
                if (!this.rtcpeerconnection && this.receiver) {
                    this.createPeerConnection()
                }

                //Parse the ice_candidate from the data's body
                let message = JSON.parse(data.message); // parse json from message

                //Add the ICE candidate to the RTCPeerConnection instance
                this.rtcpeerconnection.addIceCandidate(new RTCIceCandidate(message.candidate));

            }
            //If the message type if end_call, end the call
            else if (data.type === "end_call") {
                this.endCall()
            } else if (data.type === "call_declined") {
                this.callDeclined()
            }
            //if the call is accepted, store the receiver's device info, gotten from the data body, and act accordingly
            else if (data.type === "call_accepted") {
                this.oppositeDevice = data.answeringDevice
                this.callAccepted()
            }
            //The receiver would usually send a "ring" status  to indicate that they are available for the call. The sender therefore, should start the outgoing call ringer
            else if (data.type === "ring") {
                this.ring()
            }

        }
    }

    static acceptCall = () => {
        //TODO: Stop the incoming ringer timeout
        this.stopIncomingRingerTimeout()

        //TODO: Open the call modal
        this.callbacks.onCallModalStateChanged(true, this.callType)

        //TODO:: Close incoming call popup
        this.callbacks.onIncomingCallStatusChanged(false, this.callType)

        //TODO: Send message to other party that call has been accepted
        this.sendData({
            // type: "call_status",
            type: "call_accepted",
            // uname: pointer.username,
            room: "SIGNAL_ROOM",
            answeringDevice: store.getState().user.device
        })

        //TODO:: Set status to connecting
        this.callbacks.onCallStatusChanged("Connecting...")




    }

    static declineCall = () => {
        this.stopIncomingRingerTimeout()
    }

    //Function for when the receiving party accepts the call
    static callAccepted = () => {

        //TODO: Stop outgoing call ringotone timout
        this.stopOutgoingRingerTimeout()

        //TODO: Initiate peer connection
        this.createPeerConnection()

        //TODO:: Set status to connecting
        this.callbacks.onCallStatusChanged("Connecting...")
    }

    //Function for when the receiving party declines the call
    static callDecined = () => {
        //TODO: Stop the ringing
        this.stopOutgoingRingerTimeout()
        //TODO: Hide the call modal
        this.callbacks.onCallModalStateChanged(false)

        //TODO: reset [friend] variable
        this.friend = null

    }


    static endCall = (initiated = false) => {
        this.stopIntervalToEndCall();

        //TODO: Send message to the other party that the call has been terminated
        if (initiated) {
            this.sendData({
                // type: "call_status",
                // uname: this.username,
                type: "end_call",
                room: "SIGNAL_ROOM"
            })
        }

        //TODO: If there was an exisiting rtc peer connection:
        if (this.rtcpeerconnection) {
            let tracks = null
            //TODO: Remove all tracks from stream to close webcam
            if (this.stream !== null) {
                tracks = this.stream.getTracks();
                tracks.forEach(function (track) {
                    track.stop();
                });
            }



            //TODO: Set stream null
            this.stream = null;


            //TODO: Remove all tracks from reote stream
            if (this.remoteStream !== null) {
                tracks = this.remoteStream.getTracks();
                tracks.forEach(function (track) {
                    track.stop();
                });
            }


            //TODO:: Set remote stream null
            this.remoteStream = null;

            //TODO: Set rtc instance to null
            this.rtcpeerconnection = null
        }

        //TODO: Reset [receivier] variable 
        this.receiver = false

        //TODO: Stop the ringing by calling the outgoing and incoming ringer timeout function
        this.stopOutgoingRingerTimeout()
        this.stopIncomingRingerTimeout()

        //TODO: Hide call modal
        this.callbacks.onCallModalStateChanged(false)

        //TODO: Hide incoming call modal
        this.callbacks.onIncomingCallStatusChanged(false, this.callType)

        //TODO: Stop call timer
        this.stopCallTmer()

        //TODO: Set time back to 0
        this.seconds = 0

        //TODO: Reset call time in view
        this.callbacks.onCallTimeUpdated(this.seconds)

        //TODO: Change the call status in the view
        this.callbacks.onCallStatusChanged("")

        //TODO: Reset initiation indicator
        this.initiationMessageSeen = false
    }

    static createPeerConnection = async () => {
        ///TODO: Define configuration
        let configuration = {
            'iceServers': [
                
                {
                    'url': process.env.TURN_SERVER_URL, 
                    credential: process.env.TURN_SERVER_PASSWORD,
                    username: process.env.TURN_SERVER_USERNAME
                },

            ]
        };

        //TODO: Create RTCPeerConnection instance
        this.rtcpeerconnection = new RTCPeerConnection(configuration);

        //check if there's a stream first of all. If the user has initiated their webcam
        new Promise((resolve, reject) => {
            //If the user hasn't initiated his webcam, start the webcam
            if (!this.stream) {
                this.getMedia()
            }

            //Wait for the webcam to initialize. Once it does, add the stream to the RTCPEErConnection Instance
            let streamCheckingInterval = setInterval(() => {
                if (this.stream) {
                    clearInterval(streamCheckingInterval)
                    //TODO: Add stream and track to rtc instance
                    this.stream.getTracks().forEach(track => this.rtcpeerconnection.addTrack(track, this.stream));
                    this.rtcpeerconnection.addStream(this.stream)
                    resolve("")
                }
            }, 1000)
        })



        // TODO: Add ICE callback
        this.rtcpeerconnection.onicecandidate = (evt) => {

            if (evt.candidate) {

                this.sendData({
                    'type': 'ice_candidate',
                    // 'uname': pointer.username,
                    'message': JSON.stringify({
                        'candidate': evt.candidate
                    }),
                    'room': 'SIGNAL_ROOM'
                });
            }
        }

        //TODO: Add new negotiation callback
        this.rtcpeerconnection.onnegotiationneeded = () => {

            this.rtcpeerconnection.createOffer(this.sendLocalDesc, this.logError);
        }

        //TODO: Add stream inclusion callback
        this.rtcpeerconnection.onaddstream = (evt) => {
            //TODO: call remote stream added event handler
            this.remoteStream = evt.stream
            this.updateRemoteStreamInView()

        }

        //TODO: Add stream removal callback
        this.rtcpeerconnection.onremovestream = function (evt) {
            //TODO: Implement what should happen when stream is removed
        }

        //TODO: Add ICE connection state change callback
        this.rtcpeerconnection.oniceconnectionstatechange = (evt) => {
            if (this.rtcpeerconnection.iceConnectionState === "disconnected" ||
                this.rtcpeerconnection.iceConnectionState === "closed") {

                //TODO: Implement reconnection logic
                this.rtcpeerconnection = null
                // this.createPeerConnection()

                //TODO: Change connection status on call modal view
                this.callbacks.onCallStatusChanged("Reconnecting")

                if (!this.receiver) {
                    this.askToReconnect()
                } else {
                    this.startIntervalToEndCall()
                }




            } else if (this.rtcpeerconnection.iceConnectionState === "connected") {
                // TODO: Change connection status on call modal view
                this.callbacks.onCallStatusChanged("Connected")
                this.stopIntervalToEndCall()

                //TODO: Start call timer
                this.startCallTimer()

            } else if (this.rtcpeerconnection.iceConnectionState === "new") {
                //TODO: Change connection status on call modal view
                this.callbacks.onCallStatusChanged("Connecting...")
                this.stopIntervalToEndCall()
                this.startIntervalToEndCall()

            }
        }





    }

    static sendLocalDesc = (desc) => {


        this.rtcpeerconnection.setLocalDescription(desc, () => {
            this.sendData({
                'type': 'SDP',
                // 'uname': VideoCall.username,
                'message': JSON.stringify({
                    'sdp': this.rtcpeerconnection.localDescription
                }),
                'room': 'SIGNAL_ROOM'
            });
        }, function (error) {});
    }


    static logError = (error) => {
        //displaySignalMessage(error.name + ':' + error.message);
    }


    //Deletes all pointers to static functions used to initialize the module
    static reset = () => {
        this.callbacks = null
    }


}