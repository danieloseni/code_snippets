import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { store } from 'redux/store';

export interface AxiosRequestProgressEvent {
    loaded: number
}
export type ApiClientSuccessFunction = (response: AxiosResponse) => void
export type ApiClientErrorFunction = (response: AxiosResponse) => void
export type ApiClientTimeoutFunction = () => void
export type AxiosRequestProgressEventHandler = (event: AxiosRequestProgressEvent) => void




/**
 * This contraption aims to simplify the network calls process of the app, with axios. It features the use of interceptors to control things such as network reconnection and retrial, sending out authenticated requests and handling timeouts.
 * 
 * Its constructor accepts 4 main arguments that will be used throughout the module: the url to send the request to, the success callback, the error callback, the timeout callback, and an indication as to whether it should be an authenticated request or not
 * 
 * It features 7 functions, 5 of which actually make the network requests, and the remaining 2 are just utility functions.
 * 
 * It works with the axios library and a redux state.
 */

export default class AxiosClient {

    axiosInstance: AxiosInstance

    constructor(private url: string, private onSuccess: ApiClientSuccessFunction, private onError: ApiClientErrorFunction, private onTimeout: ApiClientTimeoutFunction, private authenticatedRequest = false) {

        //create an axios instance to be used throughout the module
        this.axiosInstance = axios.create()
    }




    /**
     * 
     * Function adds interceptors to the instance created above, that add authentication token to the request before it is sent, configures the host to which the request is to be sent, calls passes the data to the onsuccess function upon success, and passes the error to the onerror function if there is a failure
     */
    setUp() {

        //Add interceptors to the axios instance

        this.axiosInstance.interceptors.request.use(config => {

            //TODO: Implement what to happen before request is sent
            if (this.authenticatedRequest) {
                config.headers!.Authorization = "Bearer " + store.getState().user.token
            }
           
            config.baseURL = process.env.REACT_APP_PROXY || "http://localhost:5000"
            return config;
        },
            error => {
                //TODO: IMplement what to happen if there is any error

            }
        );

        this.axiosInstance.interceptors.response.use(
            //Call the onSuccess function passed upon initialization, with the AxiosResponse once successful
            response => {
                if (response) {
                    this.onSuccess(response);
                }

            },


            //Call the onError function passed upon initialization, with the AxiosResponse once successful
            error => {
                if (error.response) {
                    this.onError(error);
                }

            }
        )
    }




    /**
     * @param json The json object to be converted to FormData
     * @returns FormData The FormData processed from the json
     * 
     * Function converts json data into FormData. Some of the values in the json could be array so it specifically appends every item in that array into the FormData  
    */
    toFormData(json: any) {
        var formData = new FormData()

        const jsonKeys = Object.keys(json)

        for (let i = 0; i < jsonKeys.length; i++) {
            //While appending, check if the value of the current key is an array. If it is, loop through the value and append each individual element to the form data with the same key. This will create an array in the form data

            const currentValueInLoop = json[jsonKeys[i]];
            const currentKeyInLoop = jsonKeys[i];

            if (Array.isArray(currentValueInLoop)) {
                currentValueInLoop.forEach((data: any) => {

                    formData.append(currentKeyInLoop, data)
                })
            } else {
                formData.append(currentKeyInLoop, currentValueInLoop)

            }


        }


        return formData;
    }




    /**
     * Called on the module's instance to send a get request
    */
    get() {
        //Ensure that the url is not empty
        if (!this.url) {
            return
        }

        //Setup the axios instance and prepare it to send the request
        this.setUp()

        this.axiosInstance.get(this.url);


    }




    /**
     * Called on the module's instance to download a file and track the download progress
     * @param onDownloadProgress a function tha accepts an axiosEvent
     */

    downloadMedia(onDownloadProgress?: AxiosRequestProgressEventHandler) {
        if (!this.url) {
            return
        }

        this.setUp()

        this.axiosInstance.get(this.url, {
            headers: {

            },
            onDownloadProgress,
            responseType: 'blob'
        })

    }





    /**
     * Function sends post request with axiosInstance. Function is called on the module's instance with the data to be sent and an option progress event handler
     * 
     * @param data The JSON data to be sent over. The data will be converted to FormData before sending
     * @param onUploadProgress The function to which the progress event is passed. It tracks the progress of your upload
     */

    post(data: any, onUploadProgress?:AxiosRequestProgressEventHandler) {
        
        this.setUp();

        const config = {
            onUploadProgress
        }

        this.axiosInstance.post(this.url, this.toFormData(data), config);

    }





    /**
     * Function sends post request with axiosInstance. Function is called on the module's instance with the data to be sent and an option progress event handler
     * 
     * @param data The JSON data to be sent over.
     * @param onUploadProgress The function to which the progress event is passed. It tracks the progress of your upload
     */

    postWithoutConversion(data:any, onUploadProgress:AxiosRequestProgressEventHandler) {
        this.setUp();

        const config = {
            onUploadProgress
        }

        this.axiosInstance.post(this.url, data, config)

    }



}