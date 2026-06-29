'use strict';

jest.mock('mqtt');

const probes = [
  { name: 'pagamentos',   file: '../probes/pagamentos' },
  { name: 'autenticacao', file: '../probes/autenticacao' },
  { name: 'pedidos',      file: '../probes/pedidos' },
  { name: 'estoque',      file: '../probes/estoque' },
  { name: 'gateway',      file: '../probes/gateway' },
  { name: 'notificacoes', file: '../probes/notificacoes' },
  { name: 'relatorios',   file: '../probes/relatorios' },
  { name: 'cache',        file: '../probes/cache' },
];

describe.each(probes)('probe_$name', ({ name, file }) => {
  let mockClient;
  let connectHandler;
  let messageHandler;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockClient = { on: jest.fn(), publish: jest.fn(), subscribe: jest.fn(), end: jest.fn() };
    const mqtt = require('mqtt');
    mqtt.connect = jest.fn().mockReturnValue(mockClient);

    require(file);

    connectHandler = mockClient.on.mock.calls.find(([e]) => e === 'connect')?.[1];
    messageHandler = mockClient.on.mock.calls.find(([e]) => e === 'message')?.[1];
  });

  afterEach(() => jest.useRealTimers());

  test('conecta ao broker MQTT', () => {
    const mqtt = require('mqtt');
    expect(mqtt.connect).toHaveBeenCalledWith(expect.stringMatching(/^mqtt:\/\//));
  });

  test('publica heartbeat com os campos corretos', () => {
    connectHandler();
    jest.advanceTimersByTime(5000);
    const payload = JSON.parse(mockClient.publish.mock.calls[0][1]);
    expect(payload).toMatchObject({
      probe_id:         `probe_${name}`,
      uptime:           expect.any(Number),
      latencia:         expect.any(Number),
      ultimo_heartbeat: expect.any(String),
    });
  });

  test('publica no tópico correto', () => {
    connectHandler();
    jest.advanceTimersByTime(5000);
    expect(mockClient.publish.mock.calls[0][0]).toBe(`probes/probe_${name}/metrics`);
  });

  test('para ao receber comando stop', () => {
    connectHandler();
    jest.advanceTimersByTime(5000);
    mockClient.publish.mockClear();

    messageHandler('probes/control', Buffer.from(JSON.stringify({ action: 'stop', target: `probe_${name}` })));

    jest.advanceTimersByTime(5000);
    expect(mockClient.publish).not.toHaveBeenCalled();
  });
});
