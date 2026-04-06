declare module 'saxon-js' {
  interface Platform {
    parseXmlFromString(xml: string): any;
  }
  interface XPathAPI {
    evaluate(xpath: string, contextItem: any, options?: Record<string, any>): any;
  }
  const XPath: XPathAPI;
  function getPlatform(): Platform;
  function transform(options: Record<string, any>): any;
  export default { XPath, getPlatform, transform };
}
