from django.urls import path
from . import views

urlpatterns = [
    path('',              views.home,               name='home'),
    path('about/',        views.about_page,          name='about_page'),
    path('features/',     views.features_page,       name='features_page'),
    path('how-it-works/', views.how_it_works_page,  name='how_it_works_page'),
    path('vision/',       views.vision_page,         name='vision_page'),
    path('contact/',      views.contact_page,        name='contact_page'),
]