import { v4 } from 'uuid';
import { store } from '../redux/store';

/**
 * How it works!!!
 * 
 * 
 * External components can subscribe to messages that have a particular type.
 * 
 * A subscription is done via the subscribe function. 
 * A subscription is saved in the subscriptions variable under its specified type. Upon subscription, expternal components are given an Id that they can call the cancel subscription function with, should they want to cancel their subscription.
 * 
 * The structure of a subscription is as such:
 * {
 *      id: string - this is the id that is given to each component upon subscription,
 * 
 *      callback: Function - this is the function that is passed the new messages that come in
 * }
 * 
 * The structure of incoming/outgoing messages is as such:
 * {
 *       type: string - the type of message
 *       data: The data that is sent or that should be passed to subscribers
 * }
 */

export default class ChatWebSocketMessageBroker {
    static subscriptions = {}
    static socketConnections = {}

    static subscribe = (type, callback) => {
        const id = v4();
        if (this.subscriptions[type]) {
            this.subscriptions[type].push({
                id,
                callback
            })

            return id;
        }

        this.subscriptions[type] = [{
            id, callback
        }]

        return id;

    }

    static cancelSubscription = (type, id) => {
        this.subscriptions[type] = this.subscriptions[type]?.filter?.(subscription => subscription.id !== id);
    }

    static onNewMessage = (event) => {
        let data = JSON.parse(event.data);
        if(!data.brokertype){
            this.subscriptions["text"]?.forEach?.(({ callback }) => {
                callback(data)
            })
            return
        }
        this.subscriptions[data.brokertype]?.forEach?.(({ callback }) => {
            callback(data)
        })

    }

    static addSocketEvents = (socket, roomId) => {
        
        socket.onopen = (e) => {
        }
        socket.close = (e) => {
            this.addConnection(roomId, true)
            
        }
        socket.onerror = (e) => {
            //this.connect(friend)
        }
        socket.onmessage = (e) => {
            
            this.onNewMessage(e)
        }
    }

    static addConnection = (room, forceConnection = false) => {
        if (Array.isArray(room)) {
            room.forEach(roomId => {
                
                if ((!this.socketConnections[roomId] || forceConnection) && roomId !== null) {
                    this.socketConnections[roomId] = new WebSocket(process.env.SOCKET_HOST + roomId + "/?token=" + store.getState().user.token);

                    this.addSocketEvents(this.socketConnections[roomId], room)
                }

            })
        } else {
            if (!this.socketConnections[room] || forceConnection) {
                this.socketConnections[room] = new WebSocket(process.env.SOCKET_HOST + room + "/?token=" + store.getState().user.token);
                this.addSocketEvents(this.socketConnections[room], room)
            }
        }
    }

    static sendMessage = (type, data, roomId) => {
        let messageSendingInterval = setInterval(() => {
            if (this.socketConnections[roomId].readyState === 1) {
               
                this.socketConnections[roomId].send(JSON.stringify({
                    brokertype: type,
                    ...data
                }))                                       
                clearInterval(messageSendingInterval);
            }
        }, 1000)
    }
}