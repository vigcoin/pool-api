import * as rp from "request-promise";

export class PoolAPI {
  constructor() { }

  async request(uri: string, method: string = '', formData: object = null) {

    var options: any = {
      uri: uri,
      headers: {
        'User-Agent': 'VIG-COIN POOL Agent'
      },
      json: true // Automatically parses the JSON string in the response
    };

    if (method) {
      options.method = method;
    }

    if (formData) {
      options.body = formData;
    }

    let json = await rp(options);
    return json;
  }

  async rpc(uri: string, method: string, params: object) {
    let json = {
      id: "0",
      jsonrpc: "2.0",
      method: method,
      params: params
    }
    return await this.request(uri, 'POST', json);
  }

  async rpcArray(uri: string, array: Array<any>) {
    let jsonArray = [];
    for (var i = 0; i < array.length; i++) {
      jsonArray.push({
        id: i.toString(),
        jsonrpc: "2.0",
        method: array[i][0],
        params: array[i][1]
      });
    }
    return await this.request(uri, 'POST', jsonArray);
  }

  async daemon(config: object, method: string, params: object) {
    return await this.rpc(config.uri, method, params);
  }

  async daemonArray(config: object, array: Array<any>) {
    return await this.rpcArray(config.uri, array);
  }

  async wallet(config: object, method: string, params: object) {
    return await this.rpc(config.uri, method, params);
  }

  async pool(config:object, method: string) {
    return await this.request(config.uri, method);
  }
}