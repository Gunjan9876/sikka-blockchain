from django.shortcuts import render

def home(request):
    return render(request, 'landing/index.html', {'active_page': 'home'})

def about_page(request):
    return render(request, 'landing/about_page.html', {'active_page': 'about'})

def features_page(request):
    return render(request, 'landing/features_page.html', {'active_page': 'features'})

def how_it_works_page(request):
    return render(request, 'landing/how_it_works_page.html', {'active_page': 'how-it-works'})

def vision_page(request):
    return render(request, 'landing/vision_page.html', {'active_page': 'vision'})

def contact_page(request):
    return render(request, 'landing/contact_page.html', {'active_page': 'contact'})
