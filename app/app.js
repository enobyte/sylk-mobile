import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, ImageBackground, PermissionsAndroid, AppState, Linking, Platform, StyleSheet} from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { BreadProvider } from "material-bread";
import { registerGlobals } from 'react-native-webrtc';
import { Router, Route, Link, Switch } from 'react-router-native';
import history from './history';
import Logger from "../Logger";
import DigestAuthRequest from 'digest-auth-request';
import autoBind from 'auto-bind';
import { firebase } from '@react-native-firebase/messaging';
import VoipPushNotification from 'react-native-voip-push-notification';
import uuid from 'react-native-uuid';
import { getUniqueId, getBundleId } from 'react-native-device-info';
import RNDrawOverlay from 'react-native-draw-overlay';
import PushNotificationIOS from "@react-native-community/push-notification-ios";

registerGlobals();

import * as sylkrtc from 'sylkrtc';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep, { CONSTANTS as CK_CONSTANTS } from 'react-native-callkeep';

import RegisterBox from './components/RegisterBox';
import ReadyBox from './components/ReadyBox';
import Call from './components/Call';
import CallByUriBox from './components/CallByUriBox';
import Conference from './components/Conference';
import ConferenceByUriBox from './components/ConferenceByUriBox';
// import AudioPlayer from './components/AudioPlayer';
// import ErrorPanel from './components/ErrorPanel';
import FooterBox from './components/FooterBox';
import StatusBox from './components/StatusBox';
import IncomingCallModal from './components/IncomingCallModal';
import NotificationCenter from './components/NotificationCenter';
import LoadingScreen from './components/LoadingScreen';
import NavigationBar from './components/NavigationBar';
import Preview from './components/Preview';
import CallManager from "./CallManager";


import utils from './utils';
import config from './config';
import storage from './storage';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

const logger = new Logger("App");

function checkIosPermissions() {
    return new Promise(resolve => PushNotificationIOS.checkPermissions(resolve));
  }

const theme = {
    ...DefaultTheme,
    dark: true,
    roundness: 2,
    colors: {
        ...DefaultTheme.colors,
       primary: '#337ab7',
    //   accent: '#f1c40f',
    },
};

let bundleId = `${getBundleId()}`;
const deviceId = getUniqueId();


if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    // bundleId = `${bundleId}.dev`;
}

const callkeepOptions = {
    ios: {
        appName: 'Sylk',
        maximumCallGroups: 2,
        maximumCallsPerCallGroup: 10,
        supportsVideo: true,
        imageName: "Image-1"
    },
    android: {
        alertTitle: 'Calling account permission',
        alertDescription: 'Please allow Sylk inside All calling accounts',
        cancelButton: 'Deny',
        okButton: 'Allow',
        imageName: 'phone_account_icon',
        additionalPermissions: [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
    }
};

const mainStyle = StyleSheet.create({

 MainContainer: {
   flex: 1,
   justifyContent: 'center',
   alignItems: 'center',
   margin: 10
 },

 TextStyle :{
  fontSize : 20,
  color : '#000'
 }

});

RNCallKeep.setup(callkeepOptions);

// Application modes
const MODE_NORMAL           = Symbol('mode-normal');
const MODE_PRIVATE          = Symbol('mode-private');
const MODE_GUEST_CALL       = Symbol('mode-guest-call');
const MODE_GUEST_CONFERENCE = Symbol('mode-guest-conference');

class Sylk extends Component {
    constructor() {
        super();
        autoBind(this)
        this._loaded = false;
        this._initialSstate = {
            accountId: '',
            password: '',
            displayName: '',
            account: null,
            registrationState: null,
            registrationKeepalive: false,
            inboundCall: null,
            currentCall: null,
            isConference: false,
            connection: null,
            showIncomingModal: false,
            showScreenSharingModal: false,
            status: null,
            targetUri: '',
            missedTargetUri: '',
            loading: null,
            mode: MODE_PRIVATE,
            localMedia: null,
            generatedVideoTrack: false,
            history: [],
            serverHistory: [],
            devices: {},
            pushtoken: null,
            pushkittoken: null,
            speakerPhoneEnabled: null,
            OrientationStatus : '',
            Height_Layout : '',
            Width_Layout : '',
        };
        this.state = Object.assign({}, this._initialSstate);

        this.__notificationCenter = null;

        this.participantsToInvite = null;
        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.muteIncoming = false;

        storage.initialize();

        RNCallKeep.addEventListener('checkReachability', () => {
            RNCallKeep.setReachable();
        });

        this._callKeepManager = new CallManager(RNCallKeep, this.answerCall, this.rejectCall, this.hangupCall);

        // Load camera/mic preferences
        storage.get('devices').then((devices) => {
            if (devices) {
                this.setState({devices: devices});
            }
        });
    }

    get _notificationCenter() {
        // getter to lazy-load the NotificationCenter ref
        if (!this.__notificationCenter) {
            this.__notificationCenter = this.refs.notificationCenter;
        }
        return this.__notificationCenter;
    }

    _detectOrientation() {
        if(this.state.Width_Layout > this.state.Height_Layout) {
            console.log("Orientation is landcape")
            this.setState({
            OrientationStatus : 'Landscape Mode'
            });
        } else {
            console.log("Orientation is portrait")
            this.setState({
            OrientationStatus : 'Portrait Mode'
            });
        }
      }

    async componentDidMount() {
        this._loaded = true;

        try {
            await RNDrawOverlay.askForDispalayOverOtherAppsPermission();
            await RNCallKeep.hasPhoneAccount();
        } catch(err) {
            console.log('error');
        }

        history.push('/login');

        // prime the ref
        logger.debug('NotificationCenter ref: %o', this._notificationCenter);

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
        this._boundOnPushRegistered = this._onPushRegistered.bind(this);


        if (Platform.OS === 'android') {

            Linking.getInitialURL().then((url) => {
                if (url) {
                  console.log('Initial url is: ' + url);
                }
              }).catch(err => {
                logger.error({ err }, 'Error getting initial URL');
              });

            firebase.messaging().getToken()
            .then(fcmToken => {
                if (fcmToken) {
                    this._onPushRegistered(fcmToken);
                }
            });
        } else if (Platform.OS === 'ios') {
            VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
            VoipPushNotification.registerVoipToken();

            PushNotificationIOS.addEventListener('register', this._boundOnPushRegistered);


            //let permissions = await checkIosPermissions();
            //if (!permissions.alert) {
                PushNotificationIOS.requestPermissions();
            //}
        }

        this.boundRnStartAction = this._callkeepStartedCall.bind(this);
        this.boundRnDisplayIncomingCall = this._callkeepDisplayIncomingCall.bind(this);
        this.boundProximityDetect = this._proximityDetect.bind(this);

        RNCallKeep.addEventListener('didReceiveStartCallAction', this.boundRnStartAction);
        RNCallKeep.addEventListener('didDisplayIncomingCall', this.boundRnDisplayIncomingCall);
        DeviceEventEmitter.addListener('Proximity', this.boundProximityDetect);

        AppState.addEventListener('change', this._handleAppStateChange);

        if (Platform.OS === 'ios') {
            this._boundOnNotificationReceivedBackground = this._onNotificationReceivedBackground.bind(this);
            this._boundOnLocalNotificationReceivedBackground = this._onLocalNotificationReceivedBackground.bind(this);
            VoipPushNotification.addEventListener('notification', this._boundOnNotificationReceivedBackground);
            VoipPushNotification.addEventListener('localNotification', this._boundOnLocalNotificationReceivedBackground);
        } else if (Platform.OS === 'android') {
            firebase
                .messaging()
                .requestPermission()
                .then(() => {
                    // User has authorised
                })
                .catch(error => {
                    // User has rejected permissions
                });

            this.messageListener = firebase
                .messaging()
                .onMessage((message: RemoteMessage) => {
                    // Process your message as required
                    //on any message, register
                    console.log('======================================');
                    console.log('Handle Firebase push notification', message.data.event);
                    //logger.debug({message}, 'got a message from firebase');
                });
        }

        this._detectOrientation();
    }

    _proximityDetect(data) {
        console.log('Proximity changed', data);
    }
    _callkeepDisplayIncomingCall(data) {
        console.log('Incoming alert panel displayed');
    }

    _callkeepStartedCall(data) {
        logger.debug('accessing Call Object', this._tmpCallStartInfo, data);

        if (!this._tmpCallStartInfo && this.state.currentCall) {
            //this is likely when sopmeone presses video in callkit on an audio call :(
            return;
        }

        if (this._tmpCallStartInfo.options && this._tmpCallStartInfo.options.conference) {
            this.startConference(data.handle);
        } else if (this._tmpCallStartInfo.options) {
            this.startCall(data.handle, this._tmpCallStartInfo.options);
        } else {
            // we dont have options in the tmp var, which means this likely came from the native dialer
            // for now, we only do audio calls from the native dialer.
            this._tmpCallStartInfo = {
                uuid: data.callUUID
            };
            this.startCall(data.handle, {audio: true, video: false});
        }
        this._notificationCenter.removeNotification();
    }

    _onPushkitRegistered(token) {
        console.log('set push token', token);
        this.setState({ pushkittoken: token });
    }

    _onPushRegistered(token) {
        console.log('set push token', token);
        this.setState({ pushtoken: token });
    }

    _sendPushToken() {
        console.log('send push token');
        if (this.state.account && this.state.pushtoken) {
            let token = null;

            if (Platform.OS === 'ios') {
                token = `${this.state.pushkittoken}#${this.state.pushtoken}`;
            } else if (Platform.OS === 'android') {
                token = this.state.pushtoken;
            }
            this.state.account.setDeviceToken(token, Platform.OS, deviceId, true, bundleId);
        }
    }

    componentWillUnmount() {
        RNCallKeep.removeEventListener('didReceiveStartCallAction', this.boundRnStartAction);

        AppState.removeEventListener('change', this._handleAppStateChange);
    }

    _handleAppStateChange = nextAppState => {
        //TODO - stop if we havent been backgrounded because of becoming active from a push notification and then going background again
        // if (nextAppState.match(/background/)) {
        //     logger.debug('app moving to background so we should stop the client sylk client if we dont have an active call');
        //     if (this._callKeepManager.count === 0) {
        //         logger.debug('callmanager count is 0 so closing connection');
        //         this.state.connection.close();
        //     }
        // }

        if (nextAppState === 'active') {
            if (this._callKeepManager.count === 0 && this.state.connection) {
                this.state.connection.reconnect();
            }
        }
    }

    connectionStateChanged(oldState, newState) {
        console.log('Websocket connection state changed: ', oldState, ' ->' , newState);
        switch (newState) {
            case 'closed':
                this.setState({connection: null, loading: null});
                this._notificationCenter.postSystemNotification('Connection failed', {body: '', timeout: 5000});
                break;
            case 'ready':
                this._notificationCenter.postSystemNotification('Connected to server', {body: '', timeout: 3});
                this.processRegistration(this.state.accountId, this.state.password, this.state.displayName);
                break;
            case 'disconnected':
                if (this.state.localMedia) {
                    sylkrtc.utils.closeMediaStream(this.state.localMedia);
                }

                if (this.state.currentCall || this.state.inboundCall) {
                    InCallManager.stop({busytone: '_BUNDLE_'});
                    this.callKeepHangupCall();
                    history.push('/ready');
                }

                this.setState({
                    registrationState: 'failed',
                    currentCall: null,
                    inboundCall: null,
                    localMedia: null,
                    generatedVideoTrack: false,
                    showIncomingModal: false
                    });

//                this._notificationCenter.postSystemNotification('Connecting to server...', {body: '', timeout: 5000});

                break;
            default:
                if (this.state.registrationKeepalive !== true) {
                    this.setState({loading: 'Connecting...'});
                }
                break;
        }
    }

    notificationCenter() {
        return this._notificationCenter;
    }

    registrationStateChanged(oldState, newState, data) {
        logger.debug('Registration state changed! ', oldState, newState, data);
        this.setState({registrationState: newState});
        if (newState === 'failed') {
            RNCallKeep.setAvailable(false);
            let reason = data.reason;
            if (reason.match(/904/)) {
                // Sofia SIP: WAT
                reason = 'Bad account or password';
            } else {
                reason = 'Connection failed';
            }
            this.setState({
                loading     : null,
                status      : {
                    msg   : 'Sign In failed: ' + reason,
                    level : 'danger'
                }
            });

            if (this.state.registrationKeepalive === true) {
                if (this.state.connection !== null) {
                    logger.debug('Retry to register...');
                    //this.setState({loading: 'Register...'});
                    this._notificationCenter.postSystemNotification('Registering', {body: 'now', timeout: 10000});
                    this.state.account.register();
                } else {
                    // add a timer to retry register after awhile
                    logger.debug('Retry to register after a delay...');
                    setTimeout(this.state.account.register(), 5000);
                }
            }
        } else if (newState === 'registered') {
            this.getServerHistory();
            RNCallKeep.setAvailable(true);
            this.setState({loading: null, registrationKeepalive: true, registrationState: 'registered'});
            history.push('/ready');
            this._notificationCenter.postSystemNotification('Ready to receive calls', {body: '', timeout: 1});
            return;
        } else {
            this.setState({status: null });
            RNCallKeep.setAvailable(false);
        }
    }

    callStateChanged(oldState, newState, data) {
        if (!this.state.currentCall) {
            return;
        }

        callUUID = this.state.currentCall._callkeepUUID;
        console.log('Call UUID ' + callUUID + ' state changed: ' + oldState + ' -> ' + newState);

        switch (newState) {
            case 'progress':
                InCallManager.startRingback('_BUNDLE_');
                break;
            case 'established':
            case 'accepted':
                InCallManager.stopRingback();
                this.setState({speakerPhoneEnabled: false});

                this._callKeepManager.setCurrentCallActive(callUUID);

                if (this.state.isConference) {
                    console.log('Conference call started');
                    this._callKeepManager.backToForeground();
                    this.setState({speakerPhoneEnabled: true});

                } else if (this.state.currentCall.remoteMediaDirections) {
                    const videoTracks = this.state.currentCall.remoteMediaDirections.video;
                    if (videoTracks && videoTracks.length > 0) {
                        console.log('Video call started')
                        this._callKeepManager.backToForeground();
                        this.setState({speakerPhoneEnabled: true});
                    }
                }
                console.log('Speakerphone', this.state.speakerPhoneEnabled);

                break;
            case 'terminated':
                let callSuccesfull = false;
                let reason = data.reason;
                let play_busy_tone = true;

                let CALLKEEP_REASON;
                console.log('Call UUID ' + callUUID + ' terminated reason: ' + reason);

                if (!reason || reason.match(/200/)) {
                    if (oldState == 'progress') {
                        reason = 'Cancelled';
                        play_busy_tone = false;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                    } else {
                        reason = 'Hangup';
                        callSuccesfull = true;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    }
                } else if (reason.match(/403/)) {
                    reason = 'This domain is not served here';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/404/)) {
                    reason = 'User not found';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/408/)) {
                    reason = 'Timeout';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/480/)) {
                    reason = 'User not online';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/486/) || reason.match(/60[036]/)) {
                    reason = 'Busy';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                    play_busy_tone = false;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.MISSED;
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/5\d\d/)) {
                    reason = 'Server failure';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/904/)) {
                    // Sofia SIP: WAT
                    reason = 'Bad account or password';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else {
                    reason = 'Connection failed';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                }

                if (play_busy_tone) {
                    InCallManager.stop({busytone: '_BUNDLE_'});
                } else {
                    InCallManager.stop();
                }

                this._callKeepManager.reportEndCallWithUUID(callUUID, CALLKEEP_REASON);
                console.log('Call UUID ' + callUUID + ' terminated because ' + reason);

                let sessionId = this._callKeepManager._UUIDtosessionIDMap.has(callUUID) && this._callKeepManager._UUIDtosessionIDMap.get(callUUID);
                if (sessionId) {
                    console.log('Call session-id ' + sessionId + ' terminated because ' + reason);
                    this._callKeepManager.reportEndCallWithUUID(sessionId, CALLKEEP_REASON);
                    this._callKeepManager._sessionIDtoUUIDMap.delete(sessionId);
                    this._callKeepManager._sessionIDtocallIdMap.delete(sessionId);
                    this._callKeepManager._UUIDtosessionIDMap.delete(callUUID);
                }

                this._callKeepManager.remove();

                if (play_busy_tone) {
                    this._notificationCenter.postSystemNotification('Call ended:', {body: reason, timeout: callSuccesfull ? 5 : 10});
                }

                this.setState({
                    currentCall         : null,
                    targetUri           : callSuccesfull || config.useServerCallHistory ? '' : this.state.targetUri,
                    showIncomingModal   : false,
                    inboundCall         : null,
                    isConference        : false,
                    localMedia          : null,
                    generatedVideoTrack : false
                });
                this.setFocusEvents(false);
                this.participantsToInvite = null;

                history.push('/ready');

                setTimeout(() => {
                    this.getServerHistory();
                }, 3000);

                break;
            default:
                break;
        }
    }

//    inboundCallStateChanged(oldState, newState, data) {
//        logger.debug('Inbound call state changed! ' + newState);
//        if (newState === 'terminated') {
//            this.setState({ inboundCall: null, showIncomingModal: false });
//            this.setFocusEvents(false);
//        }
//    }

    handleCallByUri(displayName, targetUri) {
        const accountId = `${utils.generateUniqueId()}@${config.defaultGuestDomain}`;
        this.setState({
            accountId      : accountId,
            password       : '',
            displayName    : displayName,
            //mode           : MODE_GUEST_CALL,
            targetUri      : utils.normalizeUri(targetUri, config.defaultDomain),
            loading        : 'Connecting...'
        });

        if (this.state.connection === null) {
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        }
    }

    handleConferenceByUri(displayName, targetUri) {
        const accountId = `${utils.generateUniqueId()}@${config.defaultGuestDomain}`;
        this.setState({
            accountId      : accountId,
            password       : '',
            displayName    : displayName,
            //mode           : MODE_GUEST_CONFERENCE,
            targetUri      : targetUri,
            loading        : 'Connecting...'
        });

        if (this.state.connection === null) {
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        }
    }

    handleRegistration(accountId, password, remember) {
        this.setState({
            accountId : accountId,
            password  : password,
            mode      : remember ? MODE_NORMAL : MODE_PRIVATE,
            loading   : 'Connecting...'
        });

        if (this.state.connection === null) {
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        } else {
            console.log('Websocket connection active, try to register');
            this.processRegistration(accountId, password, '');
        }
    }

    processRegistration(accountId, password, displayName) {
        if (this.state.account !== null) {
            logger.debug('We already have an account, removing it');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    if (error) {
                        logger.debug(error);
                    }
                    this.setState({registrationState: null, registrationKeepalive: false});
                }
            );
        }

        const options = {
            account: accountId,
            password: password,
            displayName: displayName
        };

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingCall);
                switch (this.state.mode) {
                    case MODE_PRIVATE:
                    case MODE_NORMAL:
                        account.on('registrationStateChanged', this.registrationStateChanged);
                        account.on('incomingCall', this.incomingCall);
                        account.on('missedCall', this.missedCall);
                        account.on('conferenceInvite', this.conferenceInvite);
                        this.setState({account: account});
                        this._sendPushToken();
                        account.register();
                        logger.debug(this.state.mode);
                        if (this.state.mode !== MODE_PRIVATE) {
                            storage.set('account', {
                                accountId: this.state.accountId,
                                password: this.state.password
                            });
                        } else {
                            // Wipe storage if private login
                            //storage.remove('account'); // lets try this out
                            // history.clear().then(() => {
                            //     this.setState({history: []});
                            // });
                        }
                        break;
                    case MODE_GUEST_CALL:
                        this.setState({account: account, loading: null, registrationState: 'registered'});
                        logger.debug(`${accountId} (guest) signed in`);
                        // Start the call immediately, this is call started with "Call by URI"
                        this.startGuestCall(this.state.targetUri, {audio: true, video: true});
                        break;
                    case MODE_GUEST_CONFERENCE:
                        this.setState({account: account, loading: null, registrationState: 'registered'});
                        logger.debug(`${accountId} (conference guest) signed in`);
                        // Start the call immediately, this is call started with "Conference by URI"
                        this.startGuestConference(this.state.targetUri);
                        break;
                    default:
                        logger.debug(`Unknown mode: ${this.state.mode}`);
                        break;
                }
            } else {
                logger.debug('Add account error: ' + error);
                this.setState({loading: null, status: {msg: error.message, level:'danger'}});
            }
        });
    }

    setDevice(device) {
        const oldDevices = Object.assign({}, this.state.devices);

        if (device.kind === 'videoinput') {
            oldDevices['camera'] = device;
        } else if (device.kind === 'audioinput') {
            oldDevices['mic'] = device;
        }

        this.setState({devices: oldDevices});
        storage.set('devices', oldDevices);
        sylkrtc.utils.closeMediaStream(this.state.localMedia);
        this.getLocalMedia();
    }

    getLocalMedia(mediaConstraints={audio: true, video: true}, nextRoute=null) {    // eslint-disable-line space-infix-ops
        logger.debug('getLocalMedia(), mediaConstraints=%o', mediaConstraints);
        const constraints = Object.assign({}, mediaConstraints);

        if (constraints.video === true) {
            if ((nextRoute === '/conference' ||  this.state.mode === MODE_GUEST_CONFERENCE)) {
                constraints.video = {
                    'width': {
                        'ideal': 640
                    },
                    'height': {
                        'ideal': 480
                    }
                };

            // TODO: remove this, workaround so at least safari works when joining a video conference
            } else if ((nextRoute === '/conference' ||  this.state.mode === MODE_GUEST_CONFERENCE) && isSafari) {
                constraints.video = false;
            } else {
                // ask for 720p video
                constraints.video = {
                    'width': {
                        'ideal': 1280
                    },
                    'height': {
                        'ideal': 720
                    }
                };
            }
        }

        logger.debug('getLocalMedia(), (modified) mediaConstraints=%o', constraints);

        navigator.mediaDevices.enumerateDevices()
        .then((devices) => {
            devices.forEach((device) => {
                if ('video' in constraints && 'camera' in this.state.devices) {
                    if (constraints.video !== false && (device.deviceId === this.state.devices.camera.deviceId || device.label === this.state.devices.camera.label)) {
                        constraints.video.deviceId = {
                            exact: device.deviceId
                        };
                    }
                }
                if ('mic' in this.state.devices) {
                    if (device.deviceId === this.state.devices.mic.deviceId || device.label === this.state.devices.mic.Label) {
                        // constraints.audio = {
                        //     deviceId: {
                        //         exact: device.deviceId
                        //     }
                        // };
                    }
                }
            });
        })
        .catch((error) => {
            logger.debug('Device enumeration failed: %o', error);
        })
        .then(() => {
            return navigator.mediaDevices.getUserMedia(constraints)
        })
        .then((localStream) => {
            clearTimeout(this.loadScreenTimer);
            logger.debug('Got local Media', localStream);
            this.setState({status: null, loading: null, localMedia: localStream});
            if (nextRoute !== null) {
                history.push(nextRoute);
            }
        })
        .catch((error) => {
            logger.debug('Access failed, trying audio only: %o', error);
            navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            })
            .then((localStream) => {
                clearTimeout(this.loadScreenTimer);

                if (nextRoute != '/preview') {
                    logger.debug('Audio only media, but video was requested, creating generated video track');
                    const generatedVideoTrack = utils.generateVideoTrack(localStream);
                    localStream.addTrack(generatedVideoTrack);
                }

                this.setState({status: null, loading: null, localMedia: localStream, generatedVideoTrack: true});
                if (nextRoute !== null) {
                    history.push(nextRoute);
                }
            })
            .catch((error) => {
                logger.debug('Access to local media failed: %o', error);
                clearTimeout(this.loadScreenTimer);
                this._notificationCenter.postSystemNotification("Can't access camera or microphone", {timeout: 10});
                this.setState({
                    loading: null
                });
            });
        });
    }

    callKeepStartCall(targetUri, options) {
        this._tmpCallStartInfo = {
            uuid: uuid.v4(),
            options,
        };

        logger.debug('Callkeep start call to %s with options %s', targetUri, this._tmpCallStartInfo);

        if (Platform.OS === 'ios') {
            this._callKeepManager.startCall(this._tmpCallStartInfo.uuid, targetUri, targetUri, 'email', options.video ? true : false);
        } else if (Platform.OS === 'android') {
            this._callKeepManager.startCall(this._tmpCallStartInfo.uuid, targetUri, targetUri);
        }
    }

    startCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.addCallHistoryEntry(targetUri);
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    startGuestCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia(Object.assign({audio: true, video: true}, this._tmpCallStartInfo.options));
    }

    callKeepAnswerCall(options) {
        console.log('CallKeep answer call');
        if (this.state.currentCall) {
            this._callKeepManager.answerIncomingCall(this.state.currentCall._callkeepUUID);
        }
        this.answerCall(options);
    }

    answerCall(options) {
        console.log('Answer call');
        this.setState({showIncomingModal: false });
        this.setFocusEvents(false);

        if (this.state.inboundCall !== this.state.currentCall) {
            // terminate current call to switch to incoming one
            // this.state.inboundCall.removeListener('stateChanged', this.inboundCallStateChanged);
            this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
            //this.state.currentCall.terminate();
            this._callKeepManager.endCall(this.state.currentCall._callkeepUUID);
            this.setState({currentCall: this.state.inboundCall, inboundCall: this.state.inboundCall, localMedia: null});
            this.state.inboundCall.on('stateChanged', this.callStateChanged);
        }
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
        this.forceUpdate();
    }

    callKeepRejectCall() {
        if (this.state.currentCall) {
            this._callKeepManager.rejectCall(this.state.currentCall._callkeepUUID);
        }
        this.rejectCall();
    }

    rejectCall() {
        console.log('Reject call');
        this.setState({showIncomingModal: false});
        this.state.inboundCall.terminate();
        this.forceUpdate();
    }

    callKeepHangupCall() {
        if (this.state.currentCall) {
            this._callKeepManager.endCall(this.state.currentCall._callkeepUUID);
        }
        this.hangupCall();
    }

    hangupCall() {
        console.log('Hangup call');
        if (this.state.currentCall != null) {
            this.state.currentCall.terminate();
            console.log('Sylkrtc terminate call');
        } else {
            // We have no call but we still want to cancel
            if (this.state.localMedia != null) {
                sylkrtc.utils.closeMediaStream(this.state.localMedia);
                console.log('Sylkrtc close media');
            }
            history.push('/ready');
        }
        this.forceUpdate();
    }

    callKeepSendDtmf(digits) {
        console.log('Send DTMF', digits);
        if (this.state.currentCall) {
            this._callKeepManager.sendDTMF(this.state.currentCall._callkeepUUID, digits);
        }
    }

    callKeepToggleMute(mute) {
        console.log('Toggle mute %s', mute);
        if (this.state.currentCall) {
            this._callKeepManager.setMutedCall(this.state.currentCall._callkeepUUID, mute);
        }
    }

    toggleSpeakerPhone() {
        let mode = null;
        if (this.state.speakerPhoneEnabled === null || this.state.speakerPhoneEnabled === true) {
            mode = false;
        } else {
            mode = true;
        }

        logger.debug('Toggle speakerphone %s', mode);
        InCallManager.setForceSpeakerphoneOn(mode);

        this.setState({
            speakerPhoneEnabled: mode
        });
    }

    escalateToConference(participants) {
        this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
        this.state.currentCall.terminate();
        history.push('/ready');
        this.setState({currentCall: null, localMedia: null});
        this.participantsToInvite = participants;
        const uri = `${utils.generateSillyName()}@${config.defaultConferenceDomain}`;
        this.callKeepStartCall(uri, { conference: true });
    }

    startConference(targetUri) {
        console.log('New outgoing conference to room', targetUri);
        this.setState({targetUri: targetUri, isConference: true});
        this.getLocalMedia({audio: true, video: true}, '/conference');
    }

    startGuestConference(targetUri) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: true, video: true});
    }

    toggleMute() {
        this.muteIncoming = !this.muteIncoming;
    }

    outgoingCall(call) {
        console.log('New outgoing call to', call.remoteIdentity.uri);
        this._callKeepManager.handleSession(call, this._tmpCallStartInfo.uuid);
        InCallManager.start({media: this._tmpCallStartInfo.options && this._tmpCallStartInfo.options.video ? 'video' : 'audio'});
        this._tmpCallStartInfo = {};
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        //this._callKeepManager.updateDisplay(call._callkeepUUID, call.remoteIdentity.displayName, call.remoteIdentity.uri);
    }

    _onLocalNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        console.log('======================================');
        console.log('Handle local notify for', Platform.OS, 'mobile push notification: ', notificationContent);
    }

    _onNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();

        console.log('======================================');
        console.log('Handle notify for', Platform.OS, 'mobile push notification: ', notificationContent);

        // get the uuid from the notification
        // have we already got a waiting call in call manager? if we do, then its been "answered" and we're waiting for the invite
        // we may still never get the invite if theres network issues... so still need a timeout
        // no waiting call, so that means its still "ringing" (it may have been cancelled) so set a timer and if we havent recieved
        // an invite within 10 seconds then clear it down

        let callUUID = null;
        let callId = notificationContent['call-id'];
        let sessionId = notificationContent['session-id'];

        this._callKeepManager._sessionIDtoUUIDMap.set(sessionId, callId);
        this._callKeepManager._callIdtosessionIDMap.set(callId, sessionId);

        let incomingCallUUID = this._callKeepManager._callIdtoUUIDMap.has(callId) && this._callKeepManager._callIdtoUUIDMap.get(callId);
        if (incomingCallUUID) {
            // websocket invite arrived first
            console.log('Push arrived after web socket received call-id', callId, 'with UUID', incomingCallUUID);
            callUUID = incomingCallUUID;
            this._callKeepManager._UUIDtosessionIDMap.set(incomingCallUUID, sessionId);
            this._callKeepManager._sessionIDtoUUIDMap.set(sessionId, incomingCallUUID);
        } else {
            callUUID = sessionId;
            console.log('Push arrived before the invite over web socket, using UUID from session-id', callUUID);
            this._callKeepManager.handleSessionLater(callUUID, notificationContent);
        }

        if (VoipPushNotification.wakeupByPush) {
            console.log('We wake up by push');
            VoipPushNotification.wakeupByPush = false;
        }

        /*
        if (notificationContent['event'] === 'incoming_session') {
            VoipPushNotification.presentLocalNotification({
                alertBody:'Incoming ' + notificationContent['media-type'] + ' call from ' + notificationContent['from_display_name']
            });
        } else if (notificationContent['event'] === 'cancel') {
            VoipPushNotification.presentLocalNotification({
                alertBody:'Call cancelled'
            });
        }
        */

        VoipPushNotification.onVoipNotificationCompleted(callUUID);
    }

    incomingCall(call, mediaTypes) {
        if (!mediaTypes.audio && !mediaTypes.video) {
            console.log('Call rejected because unsupported media', mediaTypes);
            this.callKeepHangupCall();
            return;
        }

        let media_type = mediaTypes.video ? 'video' : 'audio';

        console.log('New', media_type, 'incoming call from', call.remoteIdentity['_displayName'], call.remoteIdentity['_uri']);

        this._callKeepManager.handleSession(call);

        call.mediaTypes = mediaTypes;

        if (this.state.currentCall !== null) {
            console.log('We have a call in progress');
            // TODO - handle this
        }

        InCallManager.start({media: media_type});

        console.log('Show alert panel');
        if (Platform.OS === 'ios') {
            RNCallKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName, 'email', mediaTypes.video);
        } else if (Platform.OS === 'android') {
            RNCallKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName);
        }
        this.setFocusEvents(true);
        call.on('stateChanged', this.callStateChanged);

        // showIncomingModal must be true if not using CallKeep
        this.setState({currentCall: call, inboundCall: call, showIncomingModal: false});

        // if (!this.shouldUseHashRouting) {
        //     this._notificationCenter.postSystemNotification('Incoming call', {body: `From ${call.remoteIdentity.displayName || call.remoteIdentity.uri}`, timeout: 15, silent: false});
        // }
    }

    setFocusEvents(enabled) {
        // if (this.shouldUseHashRouting) {
        //     const remote = window.require('electron').remote;
        //     if (enabled) {
        //         const currentWindow = remote.getCurrentWindow();
        //         currentWindow.on('focus', this.hasFocus);
        //         currentWindow.on('blur', this.hasNoFocus);
        //         this.setState({haveFocus: currentWindow.isFocused()});
        //     } else {
        //         const currentWindow = remote.getCurrentWindow();
        //         currentWindow.removeListener('focus', this.hasFocus);
        //         currentWindow.removeListener('blur', this.hasNoFocus);
        //     }
        // }
    }

    // hasFocus() {
    //     this.setState({haveFocus: true});
    // }

    // hasNoFocus() {
    //     this.setState({haveFocus: false});
    // }

    missedCall(data) {
        console.log('Missed call from ' + data.originator);

        this._notificationCenter.postSystemNotification('Missed call', {body: `from ${data.originator.display_name}`, timeout: 180, silent: false});
        if (this.state.currentCall !== null || !config.useServerCallHistory) {
            this._notificationCenter.postMissedCall(data.originator, () => {
                if (this.state.currentCall !== null) {
                    logger.debug('Hangup call');
                    this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                    this.state.currentCall.terminate();
                    this.callKeepHangupCall();
                    this.setState({currentCall: null, missedTargetUri: data.originator.uri, showIncomingModal: false, localMedia: null});
                } else {
                    this.setState({missedTargetUri: data.originator.uri});
                }
                history.push('/ready');
            });
        }
    }

    conferenceInvite(data) {
        console.log('Conference invite from %o to %s', data.originator, data.room);
        this._notificationCenter.postSystemNotification('Conference invite', {body: `From ${data.originator.displayName || data.originator.uri} for room ${data.room}`, timeout: 15, silent: false});
        this._notificationCenter.postConferenceInvite(data.originator, data.room, () => {
            if (this.state.currentCall !== null) {
                this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                this.state.currentCall.terminate();
                this.setState({currentCall: null, showIncomingModal: false, localMedia: null, generatedVideoTrack: false});
            }
            this.callKeepStartCall(data.room, {conference: true});
        });
    }

    startPreview() {
        this.getLocalMedia({audio: true, video: true}, '/preview');
    }

    addCallHistoryEntry(uri) {
        if (this.state.mode === MODE_NORMAL) {
            // history.add(uri).then((entries) => {
            //     this.setState({history: entries});
            // });
        } else {
            let entries = this.state.history.slice();
            if (entries.length !== 0) {
                const idx = entries.indexOf(uri);
                if (idx !== -1) {
                    entries.splice(idx, 1);
                }
                entries.unshift(uri);
                // keep just the last 50
                entries = entries.slice(0, 50);
            } else {
                entries = [uri];
            }
            this.setState({history: entries});
        }
    }

    getServerHistory() {
        if (!config.useServerCallHistory) {
            return;
        }

        if (!this.state.account) {
            return;
        }

        console.log('Requesting call history from server');
        let getServerCallHistory = new DigestAuthRequest(
            'GET',
            `${config.serverCallHistoryUrl}?action=get_history&realm=${this.state.account.id.split('@')[1]}`,
            this.state.account.id.split('@')[0],
            this.state.password
        );
        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                logger.debug('Error getting call history from server: %o', data.error_message)
                return;
            }
            let history = [];
            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'placed'; return elem});
            }
            if (data.received) {
                data.received.map(elem => {elem.direction = 'received'; return elem});
            }
            history = data.placed;
            if (data.received && history) {
                history = history.concat(data.received);
            }
            if (history) {
                history.sort((a,b) => {
                    return new Date(b.startTime) - new Date(a.startTime);
                });
                const known = [];
                history = history.filter((elem) => {
                    if (known.indexOf(elem.remoteParty) <= -1) {
                        if ((elem.media.indexOf('audio') > -1 || elem.media.indexOf('video') > -1) &&
                            (elem.remoteParty !== this.state.account.id || elem.direction !== 'placed')) {
                                known.push(elem.remoteParty);
                                return elem;
                        }
                    }
                });
                this.setState({serverHistory: history});
            }
        }, (errorCode) => {
            logger.debug('Error getting call history from server: %o', errorCode)
        });
    }

    // checkRoute(nextPath, navigation, match) {
    //     if (nextPath !== this.prevPath) {
    //         logger.debug(`Transition from ${this.prevPath} to ${nextPath}`);

    //
    //         // Press back in ready after a login, prevent initial navigation
    //         // don't deny if there is no registrationState (connection fail)
    //         if (this.prevPath === '/ready' && nextPath === '/login' && this.state.registrationState !== null) {
    //             logger.debug('Transition denied redirecting to /logout');
    //             history.push('/logout');
    //             return false;

    //         // Press back in ready after a call
    //         } else if ((nextPath === '/call' || nextPath === '/conference') && this.state.localMedia === null && this.state.registrationState === 'registered') {
    //             return false;

    //         // Press back from within a call/conference, don't navigate terminate the call and
    //         // let termination take care of navigating
    //         } else if (nextPath === '/ready' && this.state.registrationState === 'registered' && this.state.currentCall !== null) {
    //             this.state.currentCall.terminate();
    //             return false;

    //         // Guest call ended, needed to logout and display msg and logout
    //         } else if (nextPath === '/ready' && (this.state.mode === MODE_GUEST_CALL || this.state.mode === MODE_GUEST_CONFERENCE)) {
    //             history.push('/logout');
    //             this.forceUpdate();
    //         }
    //     }
    //     this.prevPath = nextPath;
    // }

    render() {

        let footerBox = <View style={styles.footer}><FooterBox /></View>;

        let extraStyles = {};

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
        }
        return (
            <BreadProvider>
                <PaperProvider theme={theme}>
                    <Router history={history} ref="router">
                        <ImageBackground source={backgroundImage} style={{width: '100%', height: '100%'}}>
                            <View style={mainStyle.MainContainer} onLayout={(event) => this.setState({
                                                                            Width_Layout : event.nativeEvent.layout.width,
                                                                            Height_Layout : event.nativeEvent.layout.height
                                                                           }, ()=> this._detectOrientation())}>
                            <SafeAreaView style={[styles.root, extraStyles]}>

                                <LoadingScreen text={this.state.loading} show={this.state.loading !== null}/>

                                {<IncomingCallModal
                                    call={this.state.inboundCall}
                                    onAnswer={this.callKeepAnswerCall}
                                    onHangup={this.callKeepRejectCall}
                                    show={this.state.showIncomingModal}
                                />}

                                {/* <Locations hash={this.shouldUseHashRouting}  onBeforeNavigation={this.checkRoute}> */}
                                <Switch>
                                    <Route exact path="/" component={this.main} />
                                    <Route exact path="/login" component={this.login} />
                                    <Route exact path="/logout" component={this.logout} />
                                    <Route exact path="/ready" component={this.ready} />
                                    <Route exact path="/call" component={this.call} />
                                    <Route path="/call/:targetUri" component={this.callByUri} />
                                    {/* <Location path="/call/:targetUri" urlPatternOptions={{segmentValueCharset: 'a-zA-Z0-9-_ \.@'}} handler={this.callByUri} /> */}
                                    <Route exact path="/conference" component={this.conference} />
                                    <Route path="/conference/:targetUri" component={this.conferenceByUri} />
                                    {/* <Location path="/conference/:targetUri" urlPatternOptions={{segmentValueCharset: 'a-zA-Z0-9-_~ %\.@'}}  handler={this.conferenceByUri} /> */}
                                    <Route exact path="/preview" component={this.preview} />
                                    <Route component={this.notFound} />
                                </Switch>

                                <NotificationCenter ref="notificationCenter" />

                            </SafeAreaView>
                            </View>
                        </ImageBackground>
                    </Router>
                </PaperProvider>
            </BreadProvider>
        );
    }

    notFound(match) {

        const status = {
            title   : '404',
            message : 'Oops, the page your looking for can\'t found',
            level   : 'danger',
            width   : 'large'
        }
        return (
            <StatusBox
                {...status}
            />
        );
    }

    ready() {
        return (
            <Fragment>
                <NavigationBar
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
                    logout = {this.logout}
                    preview = {this.startPreview}
                    toggleMute = {this.toggleMute}
                    connection = {this.state.connection}
                    registration = {this.state.registrationState}
                />
                <ReadyBox
                    account   = {this.state.account}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartCall}
                    missedTargetUri = {this.state.missedTargetUri}
                    history = {this.state.history}
                    key = {this.state.missedTargetUri}
                    serverHistory = {this.state.serverHistory}
                />
            </Fragment>
        );
    }

    preview() {
        return (
            <Fragment>
                <Preview
                    localMedia = {this.state.localMedia}
                    hangupCall = {this.hangupCall}
                    setDevice = {this.setDevice}
                    selectedDevices = {this.state.devices}
                />
            </Fragment>
        );
    }

    call() {
        return (
            <Call
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.callKeepHangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                callKeepSendDtmf = {this.callKeepSendDtmf}
                callKeepToggleMute = {this.callKeepToggleMute}
                callKeepStartCall = {this.callKeepStartCall}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
            />
        )
    }

    callByUri(urlParameters) {
        // check if the uri contains a domain
        if (urlParameters.targetUri.indexOf('@') === -1) {
            const status = {
                title   : 'Invalid user',
                message : `Oops, the domain of the user is not set in '${urlParameters.targetUri}'`,
                level   : 'danger',
                width   : 'large'
            }
            return (
                <StatusBox {...status} />
            );
        }
        return (
            <CallByUriBox
                handleCallByUri = {this.handleCallByUri}
                notificationCenter = {this.notificationCenter}
                targetUri = {urlParameters.targetUri}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                currentCall = {this.state.currentCall}
                hangupCall = {this.callKeepHangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
            />
        );
    }

    conference() {
        return (
            <Conference
                notificationCenter = {this.notificationCenter}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                participantsToInvite = {this.participantsToInvite}
                hangupCall = {this.callKeepHangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
            />
        )
    }

    conferenceByUri(urlParameters) {
        const targetUri = utils.normalizeUri(urlParameters.targetUri, config.defaultConferenceDomain);
        const idx = targetUri.indexOf('@');
        const uri = {};
        const pattern = /^[A-Za-z0-9\-\_]+$/g;
        uri.user = targetUri.substring(0, idx);

        // check if the uri.user is valid
        if (!pattern.test(uri.user)) {
            const status = {
                title   : 'Invalid conference',
                message : `Oops, the conference ID is invalid: ${targetUri}`,
                level   : 'danger',
                width   : 'large'
            }
            return (
                <StatusBox
                    {...status}
                />
            );
        }

        return (
            <ConferenceByUriBox
                notificationCenter = {this.notificationCenter}
                handler = {this.handleConferenceByUri}
                targetUri = {targetUri}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                currentCall = {this.state.currentCall}
                hangupCall = {this.callKeepHangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
            />
        );
    }

    login() {
        let registerBox;
        let statusBox;

        if (this.state.status !== null) {
            statusBox = (
                <StatusBox
                    message={this.state.status.msg}
                    level={this.state.status.level}
                />
            );
        }

        if (this.state.registrationState !== 'registered') {
            registerBox = (
                <RegisterBox
                    registrationInProgress = {this.state.registrationState !== null && this.state.registrationState !== 'failed'}
                    handleRegistration = {this.handleRegistration}
                    autoLogin={true}
                />
            );
        }

        return (
            <Fragment>
                {registerBox}
                {statusBox}
            </Fragment>
        );
    }

    logout() {
        if (this.state.registrationState !== null && (this.state.mode === MODE_NORMAL || this.state.mode === MODE_PRIVATE)) {
            this.state.account.unregister();
        }

        if (this.state.account !== null) {
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    logger.debug(error);
                }
            });
        }
        storage.set('account', {accountId: this.state.accountId, password: ''});
        this.setState({account: null, registrationState: null, status: null});
        history.push('/login');
        return null;
    }

    main() {
        return null;
    }
}

export default Sylk;
