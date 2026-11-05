package com.chipichapa.sele.android;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Outline;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.webkit.*;
import android.widget.FrameLayout;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.LinkedHashMap;

/** Untrusted sites run in plain Android WebViews, never the Capacitor bridge. */
@CapacitorPlugin(name="MobileBrowser")
public class MobileBrowserPlugin extends Plugin {
    static final int FILE_REQUEST = 7242;
    private final LinkedHashMap<String, Page> pages = new LinkedHashMap<>(16,.75f,true);
    private FrameLayout surface;
    private String selected;
    private ValueCallback<Uri[]> fileChoice;
    private int radius;
    private boolean resumed = true;
    private boolean requestedVisible;

    private class Page {
        final String id;
        final WebView view;
        boolean loading;
        String error;
        Page(String id) { this.id=id; view=new WebView(getContext()); }
    }
    private boolean validUrl(String value) {
        if (value==null || value.length()>8192) return false;
        Uri uri=Uri.parse(value);
        return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost()!=null;
    }
    private void emit(Page page) {
        JSObject state=new JSObject();
        state.put("id",page.id); state.put("url",page.view.getUrl()==null?"":page.view.getUrl());
        state.put("title",page.view.getTitle()==null?"":page.view.getTitle());
        state.put("loading",page.loading);state.put("canGoBack",page.view.canGoBack());state.put("canGoForward",page.view.canGoForward());state.put("error",page.error);
        notifyListeners("stateChanged",state);
    }
    private void opened(Page page, String url) {
        JSObject value=new JSObject();value.put("id",page.id);value.put("url",url);
        notifyListeners("urlOpened",value);
    }
    private void ensureSurface() {
        if(surface!=null)return;
        surface=new FrameLayout(getContext());surface.setVisibility(View.GONE);
        surface.setClipToOutline(true);
        surface.setOutlineProvider(new ViewOutlineProvider(){@Override public void getOutline(View view,Outline outline){outline.setRoundRect(0,0,view.getWidth(),view.getHeight(),radius);}});
        ((ViewGroup)bridge.getWebView().getParent()).addView(surface,new CoordinatorLayout.LayoutParams(1,1));
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private Page create(String id) {
        ensureSurface();
        Page page=new Page(id);
        WebSettings settings=page.view.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(true);settings.setBuiltInZoomControls(true);settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);
        settings.setSupportMultipleWindows(true);
        page.view.setContentDescription("Browser page");
        page.view.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(validUrl(url)){if(request.isForMainFrame()&&request.hasGesture())opened(page,url);return false;}
                if(request.hasGesture())external(url);
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){page.loading=true;page.error=null;emit(page);}
            @Override public void onPageFinished(WebView view,String url){page.loading=false;emit(page);}
            @Override public void doUpdateVisitedHistory(WebView view,String url,boolean reload){emit(page);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(request.isForMainFrame()){page.loading=false;page.error=error.getDescription().toString();if(page.id.equals(selected))surface.setVisibility(View.GONE);emit(page);}
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();page.loading=false;page.error="The site's secure connection could not be verified.";if(page.id.equals(selected))surface.setVisibility(View.GONE);emit(page);}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                page.error="This page stopped responding. Reload to reopen it.";page.loading=false;
                if(page.id.equals(selected))surface.setVisibility(View.GONE);
                emit(page);pages.remove(page.id);if(view.getParent() instanceof ViewGroup)((ViewGroup)view.getParent()).removeView(view);view.destroy();return true;
            }
        });
        page.view.setWebChromeClient(new WebChromeClient(){
            @Override public void onReceivedTitle(WebView view,String title){emit(page);}
            @Override public void onProgressChanged(WebView view,int progress){if(progress==100){page.loading=false;emit(page);}}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileChoice!=null)fileChoice.onReceiveValue(null);fileChoice=callback;
                try{getActivity().startActivityForResult(params.createIntent(),FILE_REQUEST);}catch(Exception error){callback.onReceiveValue(null);fileChoice=null;}return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(getActivity()).setMessage(message).setPositiveButton(android.R.string.ok,(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(getActivity()).setMessage(message).setPositiveButton(android.R.string.ok,(d,w)->result.confirm()).setNegativeButton(android.R.string.cancel,(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean userGesture,android.os.Message message){
                if(!userGesture)return false;
                WebView popup=new WebView(getContext());popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView popup,WebResourceRequest request){String url=request.getUrl().toString();if(validUrl(url)){opened(page,url);page.view.loadUrl(url);}popup.destroy();return true;}});
                ((WebView.WebViewTransport)message.obj).setWebView(popup);message.sendToTarget();return true;
            }
        });
        page.view.setDownloadListener((url,agent,disposition,mime,length)->external(url));
        pages.put(id,page);
        // Bound native memory. Inactive tabs remain in device-local renderer storage.
        if(pages.size()>12){for(String key:new java.util.ArrayList<>(pages.keySet()))if(!key.equals(selected)&&!key.equals(id)){destroy(key);break;}}
        return page;
    }
    private void external(String url){
        Uri uri=Uri.parse(url);String scheme=uri.getScheme();
        if(!java.util.Arrays.asList("http","https","mailto","tel").contains(scheme))return;
        try{getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
    }
    private void destroy(String id){Page page=pages.remove(id);if(page==null)return;if(page.view.getParent() instanceof ViewGroup)((ViewGroup)page.view.getParent()).removeView(page.view);page.view.stopLoading();page.view.destroy();if(id.equals(selected)){selected=null;if(surface!=null)surface.setVisibility(View.GONE);}}
    private String id(PluginCall call){String id=call.getString("id","");return id.length()>0&&id.length()<=200?id:null;}
    @PluginMethod public void open(PluginCall call){String id=id(call),url=call.getString("url");if(id==null||!validUrl(url)){call.reject("Enter an HTTP or HTTPS address.");return;}getActivity().runOnUiThread(()->{Page page=pages.get(id);if(page==null)page=create(id);page.error=null;page.view.loadUrl(url);call.resolve();});}
    @PluginMethod public void viewport(PluginCall call){
        String id=call.getString("id","");double width=call.getDouble("width",0d),height=call.getDouble("height",0d),viewportWidth=call.getDouble("viewportWidth",0d),x=call.getDouble("x",0d),y=call.getDouble("y",0d);
        if(!Double.isFinite(width)||!Double.isFinite(height)||!Double.isFinite(x)||!Double.isFinite(y)||viewportWidth<=0||!Double.isFinite(viewportWidth)){call.reject("Invalid browser bounds.");return;}
        getActivity().runOnUiThread(()->{
            Page page=pages.get(id);ensureSurface();
            requestedVisible=call.getBoolean("visible",false);
            if(page==null && requestedVisible && validUrl(call.getString("url"))){page=create(id);page.view.loadUrl(call.getString("url"));}
            boolean visible=call.getBoolean("visible",false)&&resumed&&page!=null&&page.error==null&&width>0&&height>0;
            if(!visible){surface.setVisibility(View.GONE);call.resolve();return;}
            if(!id.equals(selected)||page.view.getParent()!=surface){Page previous=pages.get(selected);if(previous!=null)previous.view.onPause();surface.removeAllViews();selected=id;surface.addView(page.view,new FrameLayout.LayoutParams(-1,-1));}
            WebView main=bridge.getWebView();double scale=main.getWidth()/viewportWidth;
            ViewGroup parent=(ViewGroup)main.getParent();
            CoordinatorLayout.LayoutParams layout=new CoordinatorLayout.LayoutParams(Math.max(1,(int)Math.round(width*scale)),Math.max(1,(int)Math.round(height*scale)));
            layout.leftMargin=(int)Math.round(main.getLeft()-parent.getPaddingLeft()+x*scale);layout.topMargin=(int)Math.round(main.getTop()-parent.getPaddingTop()+y*scale);
            surface.setLayoutParams(layout);radius=(int)Math.round(call.getDouble("radius",0d)*scale);surface.invalidateOutline();surface.setVisibility(View.VISIBLE);surface.bringToFront();page.view.onResume();call.resolve();
        });
    }
    @PluginMethod public void action(PluginCall call){String id=id(call);String action=call.getString("action","");getActivity().runOnUiThread(()->{Page page=pages.get(id);if(page==null){call.resolve();return;}switch(action){case "back":if(page.view.canGoBack())page.view.goBack();break;case "forward":if(page.view.canGoForward())page.view.goForward();break;case "reload":page.error=null;page.view.reload();break;case "close":destroy(id);break;case "external":external(page.view.getUrl());break;default:call.reject("Unsupported browser action.");return;}call.resolve();});}
    @PluginMethod public void hide(PluginCall call){getActivity().runOnUiThread(()->{requestedVisible=false;if(surface!=null)surface.setVisibility(View.GONE);Page current=pages.get(selected);if(current!=null)current.view.onPause();call.resolve();});}
    @PluginMethod public void dispose(PluginCall call){getActivity().runOnUiThread(()->{clear();call.resolve();});}
    private void clear(){for(String id:new java.util.ArrayList<>(pages.keySet()))destroy(id);if(surface!=null){((ViewGroup)surface.getParent()).removeView(surface);surface=null;}if(fileChoice!=null){fileChoice.onReceiveValue(null);fileChoice=null;}}
    boolean fileResult(int request,int result,Intent data){if(request!=FILE_REQUEST)return false;if(fileChoice!=null){fileChoice.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileChoice=null;}return true;}
    @Override protected void handleOnPause(){resumed=false;if(surface!=null)surface.setVisibility(View.GONE);for(Page page:pages.values())page.view.onPause();}
    @Override protected void handleOnResume(){resumed=true;Page page=pages.get(selected);if(page!=null&&requestedVisible&&page.error==null){surface.setVisibility(View.VISIBLE);page.view.onResume();}}
    @Override protected void handleOnDestroy(){getActivity().runOnUiThread(this::clear);}
}
